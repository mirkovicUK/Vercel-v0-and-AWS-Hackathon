"use server"

import {
  validateContactInput,
  isHoneypotTriggered,
  countRecentSubmissions,
  isRateLimited,
  deriveParentId,
  insertContactMessage,
  readSourceIp,
} from "@/lib/db/contact"
import { audit } from "@/lib/db/audit"

/**
 * Result shape returned to the contact form, mirroring the established
 * `{ ok, error? }` action-state convention (`ActionState`/`ChildActionState`).
 */
export interface ContactActionState {
  ok: boolean
  error?: string
}

/**
 * Submit_Action for the public contact channel. It runs the fixed-order
 * anti-abuse gauntlet — validate → honeypot → rate-limit → derive parent →
 * persist → audit — and contains **no validation or decision logic of its own**
 * beyond sequencing; every rule lives in a pure helper in `@/lib/db/contact`.
 * No `contact_messages` row is written unless validation, the honeypot check,
 * and the rate-limit check all pass.
 */
export async function submitContactAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  // 1. Validate (Req 2.1–2.4) — before any persistence.
  const v = validateContactInput({
    name: formData.get("name"),
    email: formData.get("email"),
    message: formData.get("message"),
  })
  if (!v.ok || !v.data) return { ok: false, error: v.error }
  const data = v.data

  // 2. Honeypot (Req 5.2, 5.3) — silent success, no row, no tell.
  if (isHoneypotTriggered(formData.get("website"))) {
    return { ok: true }
  }

  // 3. Rate limit per email AND per source IP (Req 4.1–4.4).
  const ip = await readSourceIp()
  const counts = await countRecentSubmissions(data.email, ip)
  if (isRateLimited(counts)) {
    return { ok: false, error: "You've sent a few messages already. Please try again later." }
  }

  // 4. Parent id from the VERIFIED session only (Req 3.2–3.4).
  const parentId = await deriveParentId()

  // 5. Persist exactly one row (Req 2.5, 2.6, 3.6).
  await insertContactMessage({
    name: data.name,
    email: data.email,
    message: data.message,
    parentId,
    sourceIp: ip,
  })

  // 6. Best-effort audit (Req 6.1–6.4) — audit() swallows its own errors and
  // carries no PII beyond the action and the verified parentId.
  await audit({ action: "contact.submitted", parentId: parentId ?? undefined })

  return { ok: true }
}
