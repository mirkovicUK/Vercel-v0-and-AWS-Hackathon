import "server-only"
import { queryOne, withTransaction } from "@/lib/aws/rds-data"

export interface RevenueEventInput {
  parentId: string | null
  stripeInvoiceId: string
  amountPence: number
  currency: string
  occurredAt: Date
}

interface InsertedIdRow {
  id: string
}

interface PriorCountRow {
  prior_count: number
}

/**
 * Record one paid invoice and update the singleton summary in ONE transaction.
 *
 * Idempotent on `stripe_invoice_id`: if the invoice already exists, skip the
 * recording entirely without re-reading the amount (Req 9.2, 9.3) and do NOT
 * touch the summary. Returns whether a new event was recorded.
 *
 * Paying-parent counting (Req 10.2, 10.3): the count tracks *distinct* paying
 * parents. A `null` parent_id is not a distinct parent, so revenue from an
 * unattributed invoice is still added to the total (Req 10.1) but never
 * increments `paying_parent_count`.
 */
export async function recordRevenueEvent(input: RevenueEventInput): Promise<{ recorded: boolean }> {
  return withTransaction(async (tx) => {
    // 1. Insert the event, idempotent on stripe_invoice_id (Req 9.1, 9.2).
    const inserted = await tx.query<InsertedIdRow>(
      `INSERT INTO revenue_events (parent_id, stripe_invoice_id, amount_pence, currency, occurred_at)
       VALUES (:pid, :invId, :amt, :currency, :occurredAt)
       ON CONFLICT (stripe_invoice_id) DO NOTHING
       RETURNING id`,
      {
        pid: input.parentId,
        invId: input.stripeInvoiceId,
        amt: input.amountPence,
        currency: input.currency,
        occurredAt: input.occurredAt,
      },
    )

    // 2. Duplicate invoice — skip entirely without touching the summary (Req 9.3).
    if (inserted.length === 0) {
      return { recorded: false }
    }
    const newId = inserted[0].id

    // 3. Count this parent's OTHER revenue events (excluding the row just inserted).
    //    Only meaningful when parent_id is not null: a null parent can never be a
    //    distinct paying parent, so we treat it as "already counted" (priorCount > 0
    //    semantics) and do not increment the count.
    let priorCount = 1
    if (input.parentId !== null) {
      const countRow = await tx.query<PriorCountRow>(
        `SELECT count(*)::int AS prior_count
         FROM revenue_events
         WHERE parent_id = :pid AND id <> :newId`,
        { pid: input.parentId, newId },
      )
      priorCount = countRow[0]?.prior_count ?? 0
    }

    const isNewPayingParent = priorCount === 0 && input.parentId !== null
    const payingDelta = isNewPayingParent ? 1 : 0

    // 4. Accumulate into the singleton summary (Req 10.1, 10.2, 10.3, 10.4).
    await tx.query(
      `INSERT INTO revenue_summary (id, total_revenue_pence, paying_parent_count, first_paid_at, updated_at)
       VALUES ('current', :amt, :payingDelta, :occurredAt, now())
       ON CONFLICT (id) DO UPDATE SET
         total_revenue_pence = revenue_summary.total_revenue_pence + EXCLUDED.total_revenue_pence,
         paying_parent_count = revenue_summary.paying_parent_count + :payingDelta,
         first_paid_at = COALESCE(revenue_summary.first_paid_at, EXCLUDED.first_paid_at),
         updated_at = now()`,
      {
        amt: input.amountPence,
        payingDelta,
        occurredAt: input.occurredAt,
      },
    )

    return { recorded: true }
  })
}

export interface RevenueSummary {
  totalRevenuePence: number
  payingParentCount: number
  firstPaidAt: string | null
}

interface RevenueSummaryRow {
  total_revenue_pence: number
  paying_parent_count: number
  first_paid_at: string | null
}

export async function getRevenueSummary(): Promise<RevenueSummary> {
  const row = await queryOne<RevenueSummaryRow>(
    `SELECT total_revenue_pence, paying_parent_count, first_paid_at
     FROM revenue_summary WHERE id = 'current'`,
  )
  if (!row) {
    return { totalRevenuePence: 0, payingParentCount: 0, firstPaidAt: null }
  }
  return {
    totalRevenuePence: Number(row.total_revenue_pence),
    payingParentCount: Number(row.paying_parent_count),
    firstPaidAt: row.first_paid_at,
  }
}
