import "server-only"
import { query } from "@/lib/aws/rds-data"

/**
 * Append-only audit log. Server writes only. Captures security- and
 * privacy-relevant actions (auth, entitlement, data export/deletion, payments)
 * so we can demonstrate accountability and support GDPR requests.
 */
export type AuditAction =
  // Auth & onboarding lifecycle
  | "auth.signup"
  | "auth.verified"
  | "auth.signin"
  | "onboarding.completed"
  // Account / profile
  | "parent.created"
  | "parent.attested"
  | "parent.deleted"
  | "child.created"
  | "child.deleted"
  // Practice sessions
  | "session.started"
  | "session.completed"
  // AI
  | "ai.help_used"
  | "ai.help_requested"
  | "ai.review_generated"
  | "ai.report_generated"
  // Billing
  | "subscription.updated"
  | "payment.recorded"
  | "billing.checkout_started"
  | "billing.portal_opened"
  | "billing.webhook_processed"
  // Privacy / access
  | "data.exported"
  | "entitlement.denied"
  // Admin
  | "admin.denied"
  | "admin.viewed"
  // Contact
  | "contact.submitted"

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
