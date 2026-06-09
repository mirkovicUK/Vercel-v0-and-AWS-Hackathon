"use server"

import { headers } from "next/headers"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import { PLAN } from "@/lib/plans"
import { requireOnboardedParent } from "@/lib/auth/guard"
import { setStripeCustomerId, getHasUsedTrial } from "@/lib/db/parents"
import { audit } from "@/lib/db/audit"

async function getOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host")
  const proto = h.get("x-forwarded-proto") ?? "https"
  return `${proto}://${host}`
}

export type TrialDecision = {
  grantTrial: boolean
  reason: "flag_used" | "prior_subscription" | "eligible" | "lookup_failed_eligible"
}

/**
 * Decide trial eligibility at checkout (Req 2.1-2.4).
 *
 * Pure-ish and injectable: it takes the `has_used_trial` flag, the Stripe customer id,
 * and a `listPriorSubscriptions` lookup fn so it can be unit/property tested without
 * hitting Stripe. Decision table:
 *
 * | has_used_trial | customer id | prior subs (status:'all') | decision                     |
 * |----------------|-------------|---------------------------|------------------------------|
 * | TRUE           | any         | not queried               | no trial  (flag_used)        |
 * | FALSE          | present     | >= 1                      | no trial  (prior_subscription)|
 * | FALSE          | present     | 0                         | trial     (eligible)         |
 * | FALSE          | none        | not queried               | trial     (eligible)         |
 * | FALSE          | present     | lookup throws             | trial     (lookup_failed_eligible, fail-open) |
 */
export async function decideTrialEligibility(args: {
  hasUsedTrial: boolean
  stripeCustomerId: string | null
  listPriorSubscriptions: (customerId: string) => Promise<number>
}): Promise<TrialDecision> {
  const { hasUsedTrial, stripeCustomerId, listPriorSubscriptions } = args

  // Flag wins outright — never query Stripe (Req 2.1).
  if (hasUsedTrial) {
    return { grantTrial: false, reason: "flag_used" }
  }

  // No local customer means no prior history to check — eligible (Req 2.3).
  if (!stripeCustomerId) {
    return { grantTrial: true, reason: "eligible" }
  }

  try {
    const priorCount = await listPriorSubscriptions(stripeCustomerId)
    if (priorCount >= 1) {
      // Prior subscription takes precedence over 2.3 (Req 2.2).
      return { grantTrial: false, reason: "prior_subscription" }
    }
    return { grantTrial: true, reason: "eligible" }
  } catch {
    // Fail-open: a failed lookup must not deny a genuinely new user (Req 2.4).
    return { grantTrial: true, reason: "lookup_failed_eligible" }
  }
}

/** Ensure the parent has a Stripe customer, creating one if needed. Returns the customer id. */
async function ensureCustomer(parentId: string, email: string, existingCustomerId: string | null): Promise<string> {
  if (existingCustomerId) return existingCustomerId
  const customer = await stripe.customers.create({
    email,
    metadata: { parentId },
  })
  await setStripeCustomerId(parentId, customer.id)
  return customer.id
}

/**
 * Start a Stripe-hosted Checkout session in subscription mode with a free trial.
 * Returns the hosted checkout URL the browser redirects to. On success Stripe
 * redirects back to `success_url`; on cancel it returns the user to `cancel_url`.
 */
export async function startSubscriptionCheckout(): Promise<{ url: string | null; error?: string }> {
  if (!isStripeConfigured()) {
    return { url: null, error: "Billing is not configured yet. Please try again later." }
  }
  // Dashboard-managed Price is the single source of truth for amount/currency.
  // STRIPE_PRICE_ID is required — no inline price fallback.
  const priceId = process.env.STRIPE_PRICE_ID
  if (!priceId) {
    return { url: null, error: "Billing is not configured yet. Please try again later." }
  }
  const parent = await requireOnboardedParent()
  const origin = await getOrigin()

  try {
    // Resolve the customer first so the prior-subscription lookup can run against it.
    const customerId = await ensureCustomer(parent.id, parent.email, parent.stripeCustomerId)

    // Decide trial eligibility at checkout (Req 2.1-2.4). Replaces the always-on trial.
    const hasUsedTrial = await getHasUsedTrial(parent.id)
    const decision = await decideTrialEligibility({
      hasUsedTrial,
      stripeCustomerId: customerId,
      listPriorSubscriptions: async (cid) =>
        (await stripe.subscriptions.list({ customer: cid, status: "all", limit: 1 })).data.length,
    })

    // Only attach trial_period_days when eligible; always set subscription metadata.
    const subscriptionData: Parameters<typeof stripe.checkout.sessions.create>[0]["subscription_data"] = {
      metadata: { parentId: parent.id, planId: PLAN.id },
      ...(decision.grantTrial ? { trial_period_days: PLAN.trialDays } : {}),
    }

    const session = await stripe.checkout.sessions.create({
      // Stripe-hosted Checkout: Stripe renders the payment page on its own domain.
      mode: "subscription",
      customer: customerId,
      allow_promotion_codes: true,
      success_url: `${origin}/billing?status=complete`,
      cancel_url: `${origin}/billing?status=cancelled`,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: subscriptionData,
      metadata: { parentId: parent.id, planId: PLAN.id },
    })

    await audit({ action: "billing.checkout_started", parentId: parent.id })
    return { url: session.url ?? null }
  } catch (err) {
    // Surface the Stripe reason (e.g. "No such price", test/live key mismatch,
    // customer in wrong mode) in logs rather than crashing into an opaque 500.
    const message = err instanceof Error ? err.message : String(err)
    console.log("[v0] startSubscriptionCheckout failed:", message)
    // TEMP DEBUG: surface the real Stripe reason to the UI to diagnose checkout
    // failures in production. Revert to the generic message once resolved.
    return { url: null, error: `Checkout error: ${message}` }
  }
}

/** Open the Stripe billing portal so the parent can manage or cancel their plan. */
export async function openBillingPortal(): Promise<{ url: string | null; error?: string }> {
  if (!isStripeConfigured()) {
    return { url: null, error: "Billing is not configured yet. Please try again later." }
  }
  const parent = await requireOnboardedParent()
  if (!parent.stripeCustomerId) {
    return { url: null, error: "No billing account found yet. Start a plan first." }
  }
  const origin = await getOrigin()
  const portal = await stripe.billingPortal.sessions.create({
    customer: parent.stripeCustomerId,
    return_url: `${origin}/billing`,
  })
  await audit({ action: "billing.portal_opened", parentId: parent.id })
  return { url: portal.url }
}
