import "server-only"
import { query, queryOne } from "@/lib/aws/rds-data"
import { ENTITLED_STATUSES, type Subscription, type SubscriptionStatus } from "@/lib/domain"

interface SubRow {
  id: string
  parent_id: string
  stripe_subscription_id: string | null
  status: SubscriptionStatus
  price_id: string | null
  current_period_end: string | null
  trial_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  updated_at: string
}

function mapSub(row: SubRow): Subscription {
  return {
    id: row.id,
    parentId: row.parent_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status,
    priceId: row.price_id,
    currentPeriodEnd: row.current_period_end,
    trialEnd: row.trial_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getSubscriptionForParent(parentId: string): Promise<Subscription | null> {
  const row = await queryOne<SubRow>(
    `SELECT id, parent_id, stripe_subscription_id, status, price_id, current_period_end,
            trial_end, cancel_at_period_end, created_at, updated_at
     FROM subscriptions WHERE parent_id = :pid`,
    { pid: parentId },
  )
  return row ? mapSub(row) : null
}

/** Upsert subscription state from a Stripe webhook. Webhook-writable only. */
export async function upsertSubscription(input: {
  parentId: string
  stripeSubscriptionId: string | null
  status: SubscriptionStatus
  priceId: string | null
  currentPeriodEnd: Date | null
  trialEnd: Date | null
  cancelAtPeriodEnd: boolean
}): Promise<void> {
  await query(
    `INSERT INTO subscriptions
       (parent_id, stripe_subscription_id, status, price_id, current_period_end, trial_end, cancel_at_period_end, updated_at)
     VALUES (:pid, :sid, :status::subscription_status, :price, :cpe, :trial, :cancel, now())
     ON CONFLICT (parent_id) DO UPDATE SET
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       status = EXCLUDED.status,
       price_id = EXCLUDED.price_id,
       current_period_end = EXCLUDED.current_period_end,
       trial_end = EXCLUDED.trial_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       updated_at = now()`,
    {
      pid: input.parentId,
      sid: input.stripeSubscriptionId,
      status: input.status,
      price: input.priceId,
      cpe: input.currentPeriodEnd,
      trial: input.trialEnd,
      cancel: input.cancelAtPeriodEnd,
    },
  )
}

export interface Entitlement {
  entitled: boolean
  status: SubscriptionStatus | null
  reason: "ok" | "no_subscription" | "past_due" | "canceled" | "expired"
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

/**
 * Authoritative entitlement check.
 *
 * - trialing / active  → entitled (this also covers "cancel at period end":
 *   Stripe keeps the subscription active/trialing through the grace window).
 * - canceled           → the subscription is gone, but honour any remaining
 *   PAID/booked period: entitled while current_period_end is still in the
 *   future, otherwise access ends. (Matches Stripe: a normal cancel-at-period-
 *   end fires `deleted` AT period end, so grace has already elapsed; an
 *   immediate/hard cancel mid-period still honours what was paid for.)
 * - past_due / unpaid / incomplete → not entitled.
 */
export async function getEntitlement(parentId: string): Promise<Entitlement> {
  const sub = await getSubscriptionForParent(parentId)
  if (!sub)
    return {
      entitled: false,
      status: null,
      reason: "no_subscription",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    }

  const base = {
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  }

  if (ENTITLED_STATUSES.includes(sub.status)) {
    return { entitled: true, reason: "ok", ...base }
  }
  if (sub.status === "past_due" || sub.status === "unpaid" || sub.status === "incomplete") {
    return { entitled: false, reason: "past_due", ...base }
  }
  // canceled: honour any remaining booked period, then revoke.
  if (sub.status === "canceled") {
    const stillValid = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() > Date.now() : false
    return { entitled: stillValid, reason: stillValid ? "ok" : "canceled", ...base }
  }
  return { entitled: false, reason: "expired", ...base }
}
