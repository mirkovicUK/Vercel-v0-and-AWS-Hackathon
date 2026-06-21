import "server-only"
import { notFound, redirect } from "next/navigation"
import { getCurrentClaims, getCurrentParent, isAdminClaims, type IdClaims } from "@/lib/auth/session"
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

/**
 * Pure authorization core for the admin guard. Decides, from the verified ID
 * token claims alone, whether the request is allowed into the admin area.
 * Extracted so the decision can be unit/property tested without any I/O.
 */
export function decideAdminAccess(claims: IdClaims | null): { allowed: boolean; parentId: string | null } {
  return { allowed: isAdminClaims(claims), parentId: claims?.sub ?? null }
}

/**
 * Gate for every admin-only surface. Fails CLOSED: any non-admin (including
 * unauthenticated) request is answered with 404 (`notFound()`) so the admin
 * area is invisible — an unauthorized user cannot distinguish "exists but
 * forbidden" from "does not exist". Returns the admin Parent identity on
 * success.
 *
 * Authorization is decided solely from the cryptographically verified ID token
 * claims (via `getCurrentClaims()`); no client-supplied header, query param, or
 * cookie other than the verified session tokens is read.
 */
export async function requireAdmin(): Promise<Parent> {
  const claims = await getCurrentClaims() // verified ID token claims, or null
  const decision = decideAdminAccess(claims)
  if (!decision.allowed) {
    // claims may be null (no session) or lack the admins group — both deny.
    await audit({ action: "admin.denied", parentId: decision.parentId })
    notFound() // throws → HTTP 404, fail closed; no metric fetch is reachable
  }
  // Authorized. Ensure the parents row exists and return the identity.
  const parent = await getCurrentParent()
  if (!parent) notFound() // defensive: claims valid but no row
  return parent
}
