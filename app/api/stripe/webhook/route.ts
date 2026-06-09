import type Stripe from "stripe"
import { stripe } from "@/lib/stripe"
import { getParentByStripeCustomerId, setHasUsedTrial } from "@/lib/db/parents"
import { upsertSubscription } from "@/lib/db/subscriptions"
import { recordRevenueEvent } from "@/lib/db/revenue"
import { audit } from "@/lib/db/audit"
import { query, queryOne } from "@/lib/aws/rds-data"
import type { SubscriptionStatus } from "@/lib/domain"

// Stripe requires the raw request body to verify the signature.
export const dynamic = "force-dynamic"

/**
 * Stripe dashboard events to register for this endpoint (Req 11, 12):
 *   - checkout.session.completed
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.paid              (revenue only — never touches subscription status)
 *   - invoice.payment_failed
 */

function tsToDate(seconds: number | null | undefined): Date | null {
  return seconds ? new Date(seconds * 1000) : null
}

/**
 * Idempotency guard (Req 12). Has this Stripe event id already been processed?
 * Checked AFTER signature verification and BEFORE dispatch so a duplicate
 * delivery is acknowledged without reprocessing.
 */
async function hasProcessedEvent(eventId: string): Promise<boolean> {
  const row = await queryOne<{ one: number }>(
    `SELECT 1 AS one FROM processed_webhook_events WHERE event_id = :id`,
    { id: eventId },
  )
  return row !== null
}

/**
 * Mark an event as processed. Written ONLY after the handler succeeds, so a
 * thrown handler leaves no suppressing marker and Stripe will retry (Req 12.3).
 * ON CONFLICT DO NOTHING keeps it safe under concurrent duplicate delivery.
 */
async function markEventProcessed(eventId: string, type: string): Promise<void> {
  await query(
    `INSERT INTO processed_webhook_events (event_id, type)
     VALUES (:id, :type)
     ON CONFLICT (event_id) DO NOTHING`,
    { id: eventId, type },
  )
}

/** Resolve the parent id from subscription metadata, falling back to the customer mapping. */
async function resolveParentId(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.parentId
  if (fromMeta) return fromMeta
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id
  const parent = await getParentByStripeCustomerId(customerId)
  return parent?.id ?? null
}

async function syncSubscription(sub: Stripe.Subscription, opts: { deleted?: boolean } = {}): Promise<void> {
  const parentId = await resolveParentId(sub)
  if (!parentId) {
    console.log("[v0] Stripe webhook: could not resolve parent for subscription", sub.id)
    return
  }

  // Latch the trial-used flag once a subscription enters the trialing state.
  // Monotonic: only ever set TRUE, never written back to FALSE (Req 3.1, 3.2, 3.3).
  if (sub.status === "trialing") {
    await setHasUsedTrial(parentId)
  }

  const priceId = sub.items.data[0]?.price?.id ?? null
  // current_period_end lives on the subscription item in recent API versions.
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items.data[0]?.current_period_end ??
    null

  // On a delete event the subscription has fully ended: force the status to
  // 'canceled' (don't trust the object) and clear any scheduled-cancel flags.
  // Otherwise detect a scheduled cancellation two ways — the classic
  // `cancel_at_period_end` flag AND the flexible-billing `cancel_at` timestamp
  // used by the newer Customer Portal.
  const cancelAt = (sub as unknown as { cancel_at?: number | null }).cancel_at ?? null
  const status: SubscriptionStatus = opts.deleted ? "canceled" : (sub.status as SubscriptionStatus)
  const cancelAtPeriodEnd = opts.deleted ? false : Boolean(sub.cancel_at_period_end) || cancelAt != null

  await upsertSubscription({
    parentId,
    stripeSubscriptionId: sub.id,
    status,
    priceId,
    currentPeriodEnd: tsToDate(periodEnd),
    trialEnd: tsToDate(sub.trial_end),
    cancelAtPeriodEnd,
  })
}

/**
 * Record revenue from a paid invoice (Req 9, 11). Revenue ONLY: this never
 * calls syncSubscription and never modifies subscription status — status
 * transitions belong solely to customer.subscription.* events (Req 11.1, 11.2).
 */
async function handleInvoicePaid(invoice: Stripe.Invoice, eventCreated: number): Promise<void> {
  const amountPaid = invoice.amount_paid ?? 0
  // Skip zero/negative amounts (e.g. 100%-off coupons, trials) (Req 9.4).
  if (amountPaid <= 0) return

  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null
  const parent = customerId ? await getParentByStripeCustomerId(customerId) : null

  const paidAt = invoice.status_transitions?.paid_at ?? eventCreated

  await recordRevenueEvent({
    parentId: parent?.id ?? null,
    stripeInvoiceId: invoice.id,
    amountPence: amountPaid,
    currency: invoice.currency ?? "gbp",
    occurredAt: new Date(paidAt * 1000),
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

  // Idempotency check (Req 12.1, 12.2): a duplicate delivery is acknowledged
  // with 200 WITHOUT reprocessing. The marker is written only after a
  // successful dispatch below.
  if (await hasProcessedEvent(event.id)) {
    return new Response("ok-duplicate", { status: 200 })
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
      case "customer.subscription.updated": {
        await syncSubscription(event.data.object as Stripe.Subscription)
        break
      }
      case "customer.subscription.deleted": {
        // Subscription fully ended: force status 'canceled', clear cancel flags.
        await syncSubscription(event.data.object as Stripe.Subscription, { deleted: true })
        break
      }
      case "invoice.paid": {
        // Revenue only — never modifies subscription status (Req 11.1, 11.2).
        await handleInvoicePaid(event.data.object as Stripe.Invoice, event.created)
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
    const message = err instanceof Error ? err.message : String(err)
    console.log("[v0] Stripe webhook handler error:", message)
    // Return 500 so Stripe retries delivery. Deliberately do NOT mark the event
    // processed — leaving no suppressing marker (Req 12.3).
    // TEMP DEBUG: include the real reason in the response body so it is visible
    // in the Stripe delivery view. Revert to "Handler error" once resolved.
    return new Response(`Handler error: ${message}`, { status: 500 })
  }

  // Dispatch succeeded: mark the event processed BEFORE acknowledging, so a
  // future duplicate is suppressed (Req 12.2).
  await markEventProcessed(event.id, event.type)

  // Audit at most a lightweight marker (no PII).
  await audit({ action: "billing.webhook_processed", detail: { type: event.type } }).catch(() => {})
  return new Response("ok", { status: 200 })
}
