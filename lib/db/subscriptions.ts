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
}

/**
 * Authoritative entitlement check. Access is granted while trialing/active.
 * A canceled subscription keeps access until current_period_end.
 */
export async function getEntitlement(parentId: string): Promise<Entitlement> {
  const sub = await getSubscriptionForParent(parentId)
  if (!sub) return { entitled: false, status: null, reason: "no_subscription", currentPeriodEnd: null }

  if (ENTITLED_STATUSES.includes(sub.status)) {
    return { entitled: true, status: sub.status, reason: "ok", currentPeriodEnd: sub.currentPeriodEnd }
  }
  if (sub.status === "past_due" || sub.status === "unpaid" || sub.status === "incomplete") {
    return { entitled: false, status: sub.status, reason: "past_due", currentPeriodEnd: sub.currentPeriodEnd }
  }
  // canceled: allow until period end.
  if (sub.status === "canceled") {
    const stillValid = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() > Date.now() : false
    return {
      entitled: stillValid,
      status: sub.status,
      reason: stillValid ? "ok" : "canceled",
      currentPeriodEnd: sub.currentPeriodEnd,
    }
  }
  return { entitled: false, status: sub.status, reason: "expired", currentPeriodEnd: sub.currentPeriodEnd }
}
