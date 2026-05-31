"use server"

import { headers } from "next/headers"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import { PLAN } from "@/lib/plans"
import { requireOnboardedParent } from "@/lib/auth/guard"
import { setStripeCustomerId } from "@/lib/db/parents"
import { audit } from "@/lib/db/audit"

async function getOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host")
  const proto = h.get("x-forwarded-proto") ?? "https"
  return `${proto}://${host}`
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
 * Start an embedded Checkout session in subscription mode with a free trial.
 * Returns the client secret for the embedded checkout component.
 */
export async function startSubscriptionCheckout(): Promise<{ clientSecret: string | null; error?: string }> {
  if (!isStripeConfigured()) {
    return { clientSecret: null, error: "Billing is not configured yet. Please try again later." }
  }
  const parent = await requireOnboardedParent()
  const customerId = await ensureCustomer(parent.id, parent.email, parent.stripeCustomerId)
  const origin = await getOrigin()

  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded_page",
    mode: "subscription",
    customer: customerId,
    return_url: `${origin}/billing?status=complete`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: PLAN.currency,
          unit_amount: PLAN.priceInPence,
          recurring: { interval: PLAN.interval },
          product_data: {
            name: PLAN.name,
            description: PLAN.description,
          },
        },
      },
    ],
    subscription_data: {
      trial_period_days: PLAN.trialDays,
      metadata: { parentId: parent.id, planId: PLAN.id },
    },
    metadata: { parentId: parent.id, planId: PLAN.id },
  })

  await audit({ action: "billing.checkout_started", parentId: parent.id })
  return { clientSecret: session.client_secret ?? null }
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
