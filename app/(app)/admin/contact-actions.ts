"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth/guard"
import { parseContactId, acknowledgeContactMessage } from "@/lib/db/contact"
import { audit } from "@/lib/db/audit"

/**
 * Result shape returned by the Acknowledge_Action, mirroring the established
 * `{ ok, error? }` action-state convention used across the app.
 */
export interface AcknowledgeActionState {
  ok: boolean
  error?: string
}

/**
 * Acknowledge_Action — the single, one-way status mutation the admin inbox
 * performs (`new → seen`). It is an independently-invocable server action
 * (reachable by anyone who can craft a POST), so it cannot lean on the
 * page-level `/admin` guard: it **re-establishes authorization itself** and
 * runs a fixed, fail-stopped order.
 *
 *   1. `requireAdmin()` FIRST — denial ⇒ notFound() ⇒ HTTP 404, no mutation (Req 11.5, 11.6).
 *   2. Validate/parse the supplied id before any SQL (Req 11.7).
 *   3. One guarded, one-way `UPDATE` (`new → seen`, else 0-row no-op) (Req 11.2–11.4).
 *   4. Best-effort audit — a logging failure never undoes the status change (Req 11.8, 11.9).
 *   5. `revalidatePath("/admin")` so the dynamic inbox re-fetches (Req 12.6).
 */
export async function acknowledgeContactAction(
  formData: FormData,
): Promise<AcknowledgeActionState> {
  // 1. Self-guard FIRST — denial throws notFound() (HTTP 404) before any read or write.
  const admin = await requireAdmin()

  // 2. Validate the supplied message id before any SQL (Req 11.7).
  const parsed = parseContactId(formData.get("id"))
  if (!parsed.ok) return { ok: false, error: parsed.error }

  // 3. The single guarded one-way UPDATE (`new → seen`, else silent 0-row no-op).
  await acknowledgeContactMessage(parsed.id)

  // 4. Best-effort audit — audit() swallows its own errors; carries only the
  //    action and the verified admin id (no submitter PII) (Req 11.8, 11.9).
  await audit({ action: "contact.acknowledged", parentId: admin.id })

  // 5. Refresh the dynamic admin render so the row now shows `seen` (Req 12.6).
  revalidatePath("/admin")

  return { ok: true }
}
