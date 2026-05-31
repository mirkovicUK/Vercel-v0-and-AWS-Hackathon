import "server-only"
import { redirect } from "next/navigation"
import { getCurrentParent } from "@/lib/auth/session"
import { getEntitlement, type Entitlement } from "@/lib/db/subscriptions"
import { audit } from "@/lib/db/audit"
import type { Parent } from "@/lib/domain"

/** Require a signed-in parent. Redirects to /sign-in otherwise. */
export async function requireParent(): Promise<Parent> {
  const parent = await getCurrentParent()
  if (!parent) redirect("/sign-in")
  return parent
}

/**
 * Require a signed-in parent who has completed onboarding (attestations).
 * Sends incomplete accounts to /onboarding.
 */
export async function requireOnboardedParent(): Promise<Parent> {
  const parent = await requireParent()
  if (!parent.guardianAttested || !parent.ageAttested) redirect("/onboarding")
  return parent
}

/**
 * The full gate for any premium surface: signed in + onboarded + entitled.
 * Non-entitled parents are routed to /billing so they can start/restore a plan.
 */
export async function requireEntitledParent(): Promise<{ parent: Parent; entitlement: Entitlement }> {
  const parent = await requireOnboardedParent()
  const entitlement = await getEntitlement(parent.id)
  if (!entitlement.entitled) {
    await audit({ action: "entitlement.denied", parentId: parent.id, detail: { reason: entitlement.reason } })
    redirect("/billing")
  }
  return { parent, entitlement }
}
