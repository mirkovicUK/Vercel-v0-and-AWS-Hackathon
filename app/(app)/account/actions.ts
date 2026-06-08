"use server"

import { redirect } from "next/navigation"
import { requireParent } from "@/lib/auth/guard"
import { getAccessToken, clearSessionCookies } from "@/lib/auth/session"
import { globalSignOut, adminDeleteUser } from "@/lib/auth/cognito"
import { listChildren } from "@/lib/db/children"
import { getRecentSessions, getSessionAnswers } from "@/lib/db/sessions"
import { getChildProgress } from "@/lib/db/progress"
import { getSubscriptionForParent } from "@/lib/db/subscriptions"
import { hardDeleteParent } from "@/lib/db/parents"
import { audit } from "@/lib/db/audit"
import { query } from "@/lib/aws/rds-data"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import type { Parent, Subscription } from "@/lib/domain"
import { buildExport } from "./export"

/** Stripe subscription statuses that must be cancelled before erasure (Req 13.1). */
const CANCELABLE_STATUSES = new Set<string>(["active", "trialing", "past_due"])

/**
 * Throwing deletion-audit write (Req 16.1, 16.2). Unlike the normal `audit()`
 * helper — which deliberately swallows its own errors so logging can never
 * break a primary action — this pre-condition write is awaited and NOT wrapped
 * in a swallowing try/catch, so a failure propagates and the caller can abort
 * the deletion. The detail retains ONLY compliance evidence (parent uid, email,
 * Stripe customer id) and never any child PII (Req 16.3).
 */
async function writeDeletionAuditOrThrow(parent: Parent): Promise<void> {
  await query(
    `INSERT INTO audit_log (parent_id, action, detail)
     VALUES (:parentId, :action, :detail::jsonb)`,
    {
      parentId: parent.id,
      action: "parent.deleted",
      detail: {
        parentUid: parent.id,
        email: parent.email,
        stripeCustomerId: parent.stripeCustomerId,
      },
    },
  )
}

/**
 * Erase the Stripe footprint (Req 13.1, 13.2). Cancels any active/trialing/
 * past-due subscription, then deletes the Stripe customer. This helper does NOT
 * swallow errors: any Stripe/network failure propagates so the caller can abort
 * the deletion and leave the account fully intact (Req 13.3).
 */
async function eraseStripe(stripeCustomerId: string | null, sub: Subscription | null): Promise<void> {
  if (!isStripeConfigured()) return

  // Cancel the subscription tracked in our own records first, when cancelable.
  if (sub?.stripeSubscriptionId && CANCELABLE_STATUSES.has(sub.status)) {
    await stripe.subscriptions.cancel(sub.stripeSubscriptionId)
  }

  if (stripeCustomerId) {
    // Catch any stragglers directly on the customer, then remove the customer.
    const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "all", limit: 100 })
    for (const s of subs.data) {
      if (CANCELABLE_STATUSES.has(s.status)) await stripe.subscriptions.cancel(s.id)
    }
    await stripe.customers.del(stripeCustomerId)
  }
}

/**
 * GDPR right to erasure (Req 13–17). Ordered and fail-closed:
 *   1. Require an authenticated parent.
 *   2. Confirmation gate — erase nothing unless the user typed DELETE (Req 17).
 *   3. Audit FIRST and require success; abort intact if it fails (Req 16).
 *   4. Stripe erasure — cancel subscriptions + delete customer; ANY error
 *      aborts with the account fully intact and retryable (Req 13).
 *   5. Aurora hard-delete — FK ON DELETE CASCADE removes all owned data (Req 14).
 *   6. Cognito delete — non-fatal; log and continue on failure (Req 15).
 *   7. Revoke sessions everywhere, clear local cookies, redirect.
 */
export async function deleteMyAccount(confirmation: string): Promise<{ error?: string }> {
  const parent = await requireParent()

  // Req 17 — deliberate confirmation. Erase nothing unless typed exactly.
  if (confirmation.trim().toUpperCase() !== "DELETE") {
    return { error: "Please type DELETE to confirm." }
  }

  // Req 16 — append-only audit MUST succeed before any erasure begins.
  try {
    await writeDeletionAuditOrThrow(parent)
  } catch (err) {
    console.error("[v0] Deletion audit write failed; aborting, nothing erased:", (err as Error).message)
    return { error: "Could not start account deletion. Please try again." }
  }

  // Req 13 — Stripe erasure. ANY error aborts with the account intact.
  try {
    const sub = await getSubscriptionForParent(parent.id)
    await eraseStripe(parent.stripeCustomerId, sub)
  } catch (err) {
    console.error("[v0] Stripe erasure failed; aborting deletion, account intact:", (err as Error).message)
    return { error: "We couldn't remove your billing details. Your account is unchanged — please try again." }
  }

  // Req 14 — hard-delete from Aurora. FK ON DELETE CASCADE removes children,
  // sessions, session_answers, progress, subscriptions, and review_reports
  // (review_reports cascade transitively via sessions). No soft-delete residue.
  await hardDeleteParent(parent.id)

  // Req 15 — free the email in Cognito. Non-fatal: log and continue on failure.
  try {
    await adminDeleteUser(parent.email)
  } catch (err) {
    console.error("[v0] Cognito user deletion failed (non-fatal):", (err as Error).message)
  }

  // Revoke sessions everywhere and clear local cookies.
  const accessToken = await getAccessToken()
  if (accessToken) await globalSignOut(accessToken)
  await clearSessionCookies()

  // redirect() throws its control-flow signal internally — keep it last and
  // outside every try/catch so it is never caught as a deletion failure.
  redirect("/?deleted=1")
}

/** Gather every piece of personal data we hold for this account (GDPR access). */
export async function gatherMyData() {
  const parent = await requireParent()
  const [children, subscription] = await Promise.all([listChildren(parent.id), getSubscriptionForParent(parent.id)])

  const childExports = await Promise.all(
    children.map(async (child) => {
      const [sessions, progress] = await Promise.all([
        getRecentSessions(child.id, 1000),
        getChildProgress(child.id),
      ])
      const sessionsWithAnswers = await Promise.all(
        sessions.map(async (s) => ({ ...s, answers: await getSessionAnswers(s.id) })),
      )
      return { child, progress, sessions: sessionsWithAnswers }
    }),
  )

  await audit({ action: "data.exported", parentId: parent.id })
  return buildExport(parent, subscription, childExports)
}
