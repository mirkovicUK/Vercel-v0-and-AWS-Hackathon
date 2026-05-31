import "server-only"
import { query } from "@/lib/aws/rds-data"

/**
 * Append-only audit log. Server writes only. Captures security- and
 * privacy-relevant actions (auth, entitlement, data export/deletion, payments)
 * so we can demonstrate accountability and support GDPR requests.
 */
export type AuditAction =
  | "parent.created"
  | "parent.attested"
  | "parent.deleted"
  | "child.created"
  | "child.deleted"
  | "session.started"
  | "session.completed"
  | "ai.help_used"
  | "ai.review_generated"
  | "subscription.updated"
  | "payment.recorded"
  | "data.exported"
  | "entitlement.denied"

export async function audit(input: {
  action: AuditAction
  parentId?: string | null
  childId?: string | null
  detail?: Record<string, unknown>
}): Promise<void> {
  // Never throw from auditing — logging must not break the primary action.
  try {
    await query(
      `INSERT INTO audit_log (parent_id, child_id, action, detail)
       VALUES (:parentId, :childId, :action, :detail::jsonb)`,
      {
        parentId: input.parentId ?? null,
        childId: input.childId ?? null,
        action: input.action,
        detail: input.detail ?? {},
      },
    )
  } catch (err) {
    console.error("[v0] audit write failed:", (err as Error).message)
  }
}
