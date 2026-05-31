import type Stripe from "stripe"
import { stripe } from "@/lib/stripe"
import { getParentByStripeCustomerId } from "@/lib/db/parents"
import { upsertSubscription } from "@/lib/db/subscriptions"
import { audit } from "@/lib/db/audit"
import type { SubscriptionStatus } from "@/lib/domain"

// Stripe requires the raw request body to verify the signature.
export const dynamic = "force-dynamic"

function tsToDate(seconds: number | null | undefined): Date | null {
  return seconds ? new Date(seconds * 1000) : null
}

/** Resolve the parent id from subscription metadata, falling back to the customer mapping. */
async function resolveParentId(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.parentId
  if (fromMeta) return fromMeta
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id
  const parent = await getParentByStripeCustomerId(customerId)
  return parent?.id ?? null
}

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const parentId = await resolveParentId(sub)
  if (!parentId) {
    console.log("[v0] Stripe webhook: could not resolve parent for subscription", sub.id)
    return
  }
  const priceId = sub.items.data[0]?.price?.id ?? null
  // current_period_end lives on the subscription item in recent API versions.
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items.data[0]?.current_period_end ??
    null

  await upsertSubscription({
    parentId,
    stripeSubscriptionId: sub.id,
    status: sub.status as SubscriptionStatus,
    priceId,
    currentPeriodEnd: tsToDate(periodEnd),
    trialEnd: tsToDate(sub.trial_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  })
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.log("[v0] STRIPE_WEBHOOK_SECRET not set — rejecting webhook.")
    return new Response("Webhook secret not configured", { status: 500 })
  }

  const signature = req.headers.get("stripe-signature")
  if (!signature) return new Response("Missing signature", { status: 400 })

  const body = await req.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret)
  } catch (err) {
    console.log("[v0] Stripe webhook signature verification failed:", (err as Error).message)
    return new Response("Invalid signature", { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode === "subscription" && session.subscription) {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id
          const sub = await stripe.subscriptions.retrieve(subId)
          await syncSubscription(sub)
        }
        break
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object as Stripe.Subscription)
        break
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice
        const subRef = (invoice as unknown as { subscription?: string | { id: string } }).subscription
        if (subRef) {
          const subId = typeof subRef === "string" ? subRef : subRef.id
          const sub = await stripe.subscriptions.retrieve(subId)
          await syncSubscription(sub)
        }
        break
      }
      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break
    }
  } catch (err) {
    console.log("[v0] Stripe webhook handler error:", (err as Error).message)
    // Return 500 so Stripe retries delivery.
    return new Response("Handler error", { status: 500 })
  }

  // Audit at most a lightweight marker (no PII).
  await audit({ action: "billing.webhook_processed", detail: { type: event.type } }).catch(() => {})
  return new Response("ok", { status: 200 })
}
