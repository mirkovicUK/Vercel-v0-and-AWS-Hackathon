"use server"

import { redirect } from "next/navigation"
import { requireParent } from "@/lib/auth/guard"
import { getAccessToken, clearSessionCookies } from "@/lib/auth/session"
import { globalSignOut } from "@/lib/auth/cognito"
import { listChildren, softDeleteChild } from "@/lib/db/children"
import { getRecentSessions, getSessionAnswers } from "@/lib/db/sessions"
import { getChildProgress } from "@/lib/db/progress"
import { getSubscriptionForParent } from "@/lib/db/subscriptions"
import { softDeleteParent } from "@/lib/db/parents"
import { audit } from "@/lib/db/audit"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import { buildExport } from "./export"

/** Cancel any live Stripe subscription so billing stops at deletion. */
async function cancelStripe(stripeCustomerId: string | null, stripeSubscriptionId: string | null) {
  if (!isStripeConfigured()) return
  try {
    if (stripeSubscriptionId) {
      await stripe.subscriptions.cancel(stripeSubscriptionId)
    } else if (stripeCustomerId) {
      const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "all", limit: 10 })
      for (const s of subs.data) {
        if (s.status !== "canceled") await stripe.subscriptions.cancel(s.id)
      }
    }
  } catch (err) {
    console.log("[v0] Stripe cancellation during account deletion failed:", (err as Error).message)
  }
}

/**
 * GDPR right to erasure. Cancels billing, soft-deletes all personal data,
 * signs the user out everywhere, and clears the local session. Cognito user
 * removal is best-effort (requires admin privileges in the deployed env).
 */
export async function deleteMyAccount(confirmation: string): Promise<{ error?: string }> {
  const parent = await requireParent()

  if (confirmation.trim().toUpperCase() !== "DELETE") {
    return { error: "Please type DELETE to confirm." }
  }

  const sub = await getSubscriptionForParent(parent.id)
  await cancelStripe(parent.stripeCustomerId, sub?.stripeSubscriptionId ?? null)

  // Soft-delete children, then the parent (sessions/answers cascade on purge).
  const children = await listChildren(parent.id)
  for (const child of children) {
    await softDeleteChild(child.id, parent.id)
  }
  await softDeleteParent(parent.id)
  await audit({ action: "parent.deleted", parentId: parent.id, detail: { children: children.length } })

  // Revoke sessions everywhere and clear local cookies.
  const accessToken = await getAccessToken()
  if (accessToken) await globalSignOut(accessToken)
  await clearSessionCookies()

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
