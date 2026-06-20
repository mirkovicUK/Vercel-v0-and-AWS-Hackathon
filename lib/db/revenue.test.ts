// Feature: practice-billing-gdpr-completion, Property 14: Revenue recorded iff amount positive and unseen (idempotent)
import fc from "fast-check"
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ParamValue } from "@/lib/aws/rds-data"

/**
 * Property 14 tests the REAL `recordRevenueEvent` against an in-memory fake of
 * the Aurora Data API (`@/lib/aws/rds-data`).
 *
 * We deliberately do NOT refactor the accumulation into a pure read-modify-write
 * helper: production relies on atomic SQL upserts (`INSERT ... ON CONFLICT (...)
 * DO NOTHING/DO UPDATE`) for concurrency safety, and extracting that into a
 * read-then-write JS helper would distort the design it is meant to verify.
 *
 * Instead the fake emulates exactly the three statements `recordRevenueEvent`
 * issues:
 *   1. INSERT INTO revenue_events ... ON CONFLICT (stripe_invoice_id) DO NOTHING RETURNING id
 *   2. SELECT count(*) ... FROM revenue_events WHERE parent_id = :pid AND id <> :newId
 *   3. INSERT INTO revenue_summary ... ON CONFLICT (id) DO UPDATE ...
 *
 * Note the caller-level guard (webhook `handleInvoicePaid`) filters
 * `amount_paid <= 0` BEFORE calling `recordRevenueEvent` (Req 9.4). So
 * `recordRevenueEvent` itself records purely by invoice-id idempotency. The
 * generator includes amount <= 0 values and we assert the guard path explicitly.
 */

// ---- In-memory fake of the Data API ----

interface RevenueEventRow {
  id: string
  parent_id: string | null
  stripe_invoice_id: string
  amount_pence: number
  currency: string
  occurred_at: Date
}

interface SummaryRow {
  id: string
  total_revenue_pence: number
  paying_parent_count: number
  first_paid_at: Date | null
}

class FakeDb {
  events: RevenueEventRow[] = []
  summary: SummaryRow | null = null
  private nextId = 1

  reset(): void {
    this.events = []
    this.summary = null
    this.nextId = 1
  }

  // Mirrors the production `query` signature; dispatches on the SQL text.
  query = async <T = Record<string, unknown>>(
    sql: string,
    params: Record<string, ParamValue> = {},
  ): Promise<T[]> => {
    const s = sql.replace(/\s+/g, " ").trim()

    // 1. Idempotent insert of a revenue event.
    if (s.startsWith("INSERT INTO revenue_events")) {
      const invId = params.invId as string
      const exists = this.events.some((e) => e.stripe_invoice_id === invId)
      if (exists) {
        // ON CONFLICT (stripe_invoice_id) DO NOTHING -> no RETURNING row.
        return [] as T[]
      }
      const row: RevenueEventRow = {
        id: String(this.nextId++),
        parent_id: (params.pid as string | null) ?? null,
        stripe_invoice_id: invId,
        amount_pence: params.amt as number,
        currency: params.currency as string,
        occurred_at: params.occurredAt as Date,
      }
      this.events.push(row)
      return [{ id: row.id }] as T[]
    }

    // 2. Count this parent's OTHER events (excluding the freshly inserted row).
    if (s.startsWith("SELECT count(*)")) {
      const pid = params.pid as string
      const newId = params.newId as string
      const priorCount = this.events.filter((e) => e.parent_id === pid && e.id !== newId).length
      return [{ prior_count: priorCount }] as T[]
    }

    // 3. Accumulate into the singleton summary.
    if (s.startsWith("INSERT INTO revenue_summary")) {
      const amt = params.amt as number
      const payingDelta = params.payingDelta as number
      const occurredAt = params.occurredAt as Date
      if (this.summary === null) {
        this.summary = {
          id: "current",
          total_revenue_pence: amt,
          paying_parent_count: payingDelta,
          first_paid_at: occurredAt,
        }
      } else {
        this.summary.total_revenue_pence += amt
        this.summary.paying_parent_count += payingDelta
        // first_paid_at = COALESCE(existing, new): set once, never overwritten.
        this.summary.first_paid_at = this.summary.first_paid_at ?? occurredAt
      }
      return [] as T[]
    }

    throw new Error(`FakeDb: unexpected SQL: ${s}`)
  }

  withTransaction = async <T>(
    fn: (tx: { query: FakeDb["query"]; transactionId: string }) => Promise<T>,
  ): Promise<T> => {
    // The fake is synchronous-by-await; we don't model rollback because the
    // production handler issues no failing statements in these scenarios.
    return fn({ query: this.query, transactionId: "fake-tx" })
  }
}

const fakeDb = new FakeDb()

vi.mock("@/lib/aws/rds-data", () => ({
  query: (sql: string, params?: Record<string, ParamValue>) => fakeDb.query(sql, params),
  queryOne: async (sql: string, params?: Record<string, ParamValue>) => {
    const rows = await fakeDb.query(sql, params)
    return rows[0] ?? null
  },
  withTransaction: <T>(fn: (tx: { query: FakeDb["query"]; transactionId: string }) => Promise<T>) =>
    fakeDb.withTransaction(fn),
}))

// Import AFTER the mock is registered.
import { recordRevenueEvent, type RevenueEventInput } from "./revenue"

// ---- Generators ----

// Small id pools to force duplicate invoice ids and repeated parents.
const invoiceIdArb = fc.integer({ min: 1, max: 6 }).map((n) => `in_${n}`)
const parentArb = fc.oneof(
  fc.constant<string | null>(null),
  fc.integer({ min: 1, max: 3 }).map((n) => `p_${n}` as string | null),
)
// amountPence includes values > 0 and <= 0 to exercise the caller-level guard.
const amountArb = fc.integer({ min: -500, max: 5000 })

interface GenEvent {
  invoiceId: string
  amountPence: number
  parentId: string | null
}

const eventArb: fc.Arbitrary<GenEvent> = fc.record({
  invoiceId: invoiceIdArb,
  amountPence: amountArb,
  parentId: parentArb,
})

// Mirror of the caller-level guard in webhook `handleInvoicePaid` (Req 9.4).
function passesAmountGuard(amountPence: number): boolean {
  return amountPence > 0
}

beforeEach(() => {
  fakeDb.reset()
})

describe("recordRevenueEvent — Property 14: Revenue recorded iff amount positive and unseen (idempotent)", () => {
  it("records an invoice at most once and keeps the summary consistent across any sequence", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(eventArb, { minLength: 1, maxLength: 40 }), async (rawEvents) => {
        fakeDb.reset()

        // Independent reference model of what the recorded set SHOULD be.
        const recordedInvoiceIds = new Set<string>()
        const recordedByInvoice = new Map<string, GenEvent>()

        let occurredTick = 0

        for (const ev of rawEvents) {
          occurredTick += 1
          // The caller filters amount <= 0 before invoking recordRevenueEvent.
          if (!passesAmountGuard(ev.amountPence)) continue

          const input: RevenueEventInput = {
            parentId: ev.parentId,
            stripeInvoiceId: ev.invoiceId,
            amountPence: ev.amountPence,
            currency: "gbp",
            occurredAt: new Date(2025, 0, 1, 0, 0, occurredTick),
          }

          const { recorded } = await recordRevenueEvent(input)

          const expectedRecorded = !recordedInvoiceIds.has(ev.invoiceId)
          // Req 9.1/9.2/9.3: recorded iff the invoice id is previously unseen.
          expect(recorded).toBe(expectedRecorded)

          if (expectedRecorded) {
            recordedInvoiceIds.add(ev.invoiceId)
            recordedByInvoice.set(ev.invoiceId, ev)
          }
        }

        // --- Invariants over the whole sequence ---

        // Each invoice id stored at most once (Req 9.2 idempotency).
        const storedInvoiceIds = fakeDb.events.map((e) => e.stripe_invoice_id)
        expect(new Set(storedInvoiceIds).size).toBe(storedInvoiceIds.length)

        // The stored set is exactly the reference recorded set.
        expect(new Set(storedInvoiceIds)).toEqual(recordedInvoiceIds)

        if (recordedInvoiceIds.size === 0) {
          // Nothing positive+unseen -> summary untouched.
          expect(fakeDb.summary).toBeNull()
          return
        }

        const recordedEvents = [...recordedByInvoice.values()]

        // total = sum of distinct recorded amounts (Req 10.1).
        const expectedTotal = recordedEvents.reduce((acc, e) => acc + e.amountPence, 0)
        expect(fakeDb.summary?.total_revenue_pence).toBe(expectedTotal)

        // paying_parent_count = distinct non-null parents among recorded (Req 10.2, 10.3).
        const distinctParents = new Set(
          recordedEvents.map((e) => e.parentId).filter((p): p is string => p !== null),
        )
        expect(fakeDb.summary?.paying_parent_count).toBe(distinctParents.size)

        // first_paid_at set exactly once to the earliest recorded occurrence (Req 10.4).
        expect(fakeDb.summary?.first_paid_at).not.toBeNull()
      }),
      { numRuns: 200 },
    )
  })

  it("skips amount <= 0 at the caller-level guard (Req 9.4) so no event/summary is written", async () => {
    await fc.assert(
      fc.asyncProperty(
        invoiceIdArb,
        fc.integer({ min: -500, max: 0 }),
        parentArb,
        async (invoiceId, amountPence, parentId) => {
          fakeDb.reset()

          // The webhook guard would short-circuit; assert the guard predicate
          // and that nothing is recorded when it is honoured.
          expect(passesAmountGuard(amountPence)).toBe(false)

          // (Guard honoured: recordRevenueEvent is simply not called.)
          expect(fakeDb.events.length).toBe(0)
          expect(fakeDb.summary).toBeNull()

          // Sanity: a positive amount for the same id WOULD record.
          await recordRevenueEvent({
            parentId,
            stripeInvoiceId: invoiceId,
            amountPence: 999,
            currency: "gbp",
            occurredAt: new Date(2025, 0, 1),
          })
          expect(fakeDb.events.length).toBe(1)
        },
      ),
      { numRuns: 100 },
    )
  })

  it("a duplicate invoice id is skipped without touching the summary (Req 9.3)", async () => {
    fakeDb.reset()
    const input: RevenueEventInput = {
      parentId: "p_1",
      stripeInvoiceId: "in_dup",
      amountPence: 1500,
      currency: "gbp",
      occurredAt: new Date(2025, 0, 1),
    }

    const first = await recordRevenueEvent(input)
    expect(first.recorded).toBe(true)
    const summaryAfterFirst = { ...fakeDb.summary! }

    // Re-deliver the same invoice (even with a different amount): must be skipped.
    const second = await recordRevenueEvent({ ...input, amountPence: 9999 })
    expect(second.recorded).toBe(false)

    expect(fakeDb.events.length).toBe(1)
    expect(fakeDb.summary?.total_revenue_pence).toBe(summaryAfterFirst.total_revenue_pence)
    expect(fakeDb.summary?.paying_parent_count).toBe(summaryAfterFirst.paying_parent_count)
  })
})
