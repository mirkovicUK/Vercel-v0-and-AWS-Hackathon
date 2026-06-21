import "server-only"
import { query, queryOne } from "@/lib/aws/rds-data"
import { getRevenueSummary } from "@/lib/db/revenue"
import { SESSION_STATUSES, SUBSCRIPTION_STATUSES, TOPICS } from "@/lib/domain"
import type { RevenueSummary } from "@/lib/db/revenue"
import type { SessionStatus, SubscriptionStatus, Topic } from "@/lib/domain"

/**
 * Read-only Metrics_Service for the Admin Dashboard.
 *
 * This module exposes aggregate, PII-minimal metrics over the existing Aurora
 * schema. The payload types in this file form a **PII firewall by construction**:
 * none of them carries a child field, a Cognito `sub`, a `stripe_customer_id`, a
 * question's `text`/`options`/`correct_index`, or an audit-log `detail`. The only
 * individual-record personal field anywhere is `RecentInvoice.parentEmail`, which
 * is `null` for an unattributed invoice (Req 12.1–12.4).
 *
 * The SELECT-only query functions and the concurrent `getAdminMetrics()`
 * aggregator are added in a later task; this file currently provides the typed
 * payload contracts and the pure, in-memory mapping helpers those queries build
 * on. The helpers are deliberately free of I/O so they can be exercised
 * deterministically by the property tests (the `server-only` import is stubbed
 * by the test runner — see `vitest.config.ts`).
 */

// ---- Payload types (aggregate, PII-minimal) ----

export interface RecentInvoice {
  amountPence: number
  currency: string
  occurredAt: string
  parentEmail: string | null // null = unattributed invoice (Req 5.4)
}

export interface SubscriptionMetrics {
  // All six SubscriptionStatus keys present, 0 when absent (Req 6.2, 6.3).
  byStatus: Record<SubscriptionStatus, number>
  cancelAtPeriodEnd: number
}

export interface UserMetrics {
  activeParents: number
  deletedParents: number
  newParents30d: number
  activeChildren: number
}

export interface EngagementMetrics {
  totalSessions: number
  // All four SessionStatus keys present, 0 when absent.
  byStatus: Record<SessionStatus, number>
  sessions30d: number
  totalHelpUsed: number
  reviewReportsByGenerator: { nova: number; fallback: number }
}

export interface ContentMetrics {
  totalQuestions: number
  activeQuestions: number
  inactiveQuestions: number
  // All topics present, 0 when absent (Req 9.2).
  byTopic: Record<Topic, number>
}

export interface ProcessedWebhookEvent {
  type: string
  processedAt: string
}

export interface AuditEntry {
  action: string
  createdAt: string
  // NOTE: no `detail` field — never selected from the DB (Req 10.5, 12.1).
}

export interface OperationalMetrics {
  recentWebhookEvents: ProcessedWebhookEvent[] // ≤ 10
  recentAuditEntries: AuditEntry[] // ≤ 20
}

/**
 * Each section either resolves with its data or carries an error flag, so the
 * page renders the remaining sections even if one query fails (Req 14.3).
 */
export type SettledSection<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export interface AdminMetrics {
  revenue: SettledSection<RevenueSummary>
  invoices: SettledSection<RecentInvoice[]>
  subscriptions: SettledSection<SubscriptionMetrics>
  users: SettledSection<UserMetrics>
  engagement: SettledSection<EngagementMetrics>
  content: SettledSection<ContentMetrics>
  operations: SettledSection<OperationalMetrics>
}

// ---- Pure mapping helpers (no I/O — unit/property testable) ----

/** Fixed key sets for the grouped-count domains, re-exported for query callers. */
export { SESSION_STATUSES, SUBSCRIPTION_STATUSES, TOPICS }

/** A single `GROUP BY ... COUNT(*)` row: a key and its aggregate count. */
export interface GroupedCountRow {
  key: string
  count: number
}

/**
 * Map grouped `(key, count)` aggregate rows onto a complete keyed record over a
 * fixed key set. Every expected key is present; keys absent from the rows
 * default to `0`. Keys outside the fixed set are ignored (defensive against
 * legacy/unexpected enum values, mirroring the convention in `lib/db/adaptive.ts`).
 *
 * Invariant (Req 6.1–6.3, 8.2, 8.4, 9.2): for rows whose keys all belong to the
 * fixed set, the sum of the mapped counts equals the sum of the row counts.
 */
export function mapGroupedCounts<K extends string>(
  rows: GroupedCountRow[],
  keys: readonly K[],
): Record<K, number> {
  const result = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>
  for (const row of rows) {
    if (row.key in result) {
      result[row.key as K] += Number(row.count)
    }
  }
  return result
}

/** Raw `revenue_events`-joined-`parents` row as selected by the recent-invoices query. */
export interface RecentInvoiceRow {
  amount_pence: number
  currency: string
  occurred_at: string
  parent_email: string | null
}

/**
 * Map one recent-invoice row to its payload. A null `parent_id` (and therefore a
 * null joined `parent_email`) yields `parentEmail: null` — an unattributed
 * invoice is never given a fabricated identity (Req 5.4).
 */
export function mapInvoiceRow(row: RecentInvoiceRow): RecentInvoice {
  return {
    amountPence: Number(row.amount_pence),
    currency: row.currency,
    occurredAt: row.occurred_at,
    parentEmail: row.parent_email ?? null,
  }
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * True iff `timestamp` falls within the trailing-30-day window `[now − 30d, now]`.
 * The window is inclusive at both boundaries and future-dated timestamps are
 * excluded (Req 7.3, 8.3).
 */
export function classifyWithin30Days(timestamp: string | number | Date, now: Date): boolean {
  const t = new Date(timestamp).getTime()
  const nowMs = now.getTime()
  if (Number.isNaN(t) || Number.isNaN(nowMs)) return false
  return t >= nowMs - THIRTY_DAYS_MS && t <= nowMs
}

/**
 * Collapse a settled promise into a `SettledSection`: a fulfilled query becomes
 * `{ ok: true, data }`; a rejected one becomes `{ ok: false }` for that section
 * only, so a single failure never blanks the rest of the page (Req 14.3).
 */
export function settle<T>(r: PromiseSettledResult<T>): SettledSection<T> {
  return r.status === "fulfilled"
    ? { ok: true, data: r.value }
    : { ok: false, error: "Failed to load this section." }
}

// ---- SELECT-only query functions (one per metric group) ----
//
// Every statement below is a read-only `SELECT` issued through the RDS Data API
// helpers (Req 11.1, 11.2). Grouped metrics use a single `COUNT/SUM/GROUP BY`
// aggregate query rather than counting rows in the application (Req 13.1); list
// queries carry an explicit `LIMIT` (Req 13.2). None of these functions performs
// authorization — the gate runs once at the `/admin` page boundary (Req 3.1).

/**
 * The 10 most recent paid invoices, joined to the paying parent's email only.
 *
 * A `LEFT JOIN` keeps unattributed invoices (null `parent_id`) and yields
 * `parent_email = null`, surfaced as `parentEmail: null` (Req 5.1, 5.4). Only the
 * parent `email` is selected — never `sub`/`id` beyond the join key or
 * `stripe_customer_id` (Req 5.3, 12.2).
 */
export async function getRecentInvoices(): Promise<RecentInvoice[]> {
  const rows = await query<RecentInvoiceRow>(
    `SELECT re.amount_pence, re.currency, re.occurred_at, p.email AS parent_email
     FROM revenue_events re
     LEFT JOIN parents p ON p.id = re.parent_id
     ORDER BY re.occurred_at DESC
     LIMIT 10`,
  )
  return rows.map(mapInvoiceRow)
}

/**
 * Subscription counts grouped by status plus the count set to cancel at period
 * end. The grouped rows are mapped onto all six `SubscriptionStatus` values,
 * defaulting absent statuses to `0` (Req 6.1, 6.2, 6.3, 6.4).
 */
export async function getSubscriptionMetrics(): Promise<SubscriptionMetrics> {
  const [statusRows, cancelRow] = await Promise.all([
    query<GroupedCountRow>(
      `SELECT status AS key, COUNT(*)::int AS count
       FROM subscriptions
       GROUP BY status`,
    ),
    queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM subscriptions
       WHERE cancel_at_period_end = TRUE`,
    ),
  ])
  return {
    byStatus: mapGroupedCounts(statusRows, SUBSCRIPTION_STATUSES),
    cancelAtPeriodEnd: Number(cancelRow?.count ?? 0),
  }
}

interface UserCountsRow {
  active_parents: number
  deleted_parents: number
  new_parents_30d: number
}

/**
 * Parent lifecycle counts (active / soft-deleted / new in the trailing 30 days)
 * plus the active children count. The 30-day window is computed in SQL with
 * `now() - interval '30 days'` (Req 7.1, 7.2, 7.3). No child column other than
 * the count is selected (Req 7.4, 7.5, 12.3).
 */
export async function getUserMetrics(): Promise<UserMetrics> {
  const [parentRow, childRow] = await Promise.all([
    queryOne<UserCountsRow>(
      `SELECT
         COUNT(*) FILTER (WHERE deleted_at IS NULL)::int                                              AS active_parents,
         COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int                                          AS deleted_parents,
         COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= now() - interval '30 days')::int AS new_parents_30d
       FROM parents`,
    ),
    queryOne<{ active_children: number }>(
      `SELECT COUNT(*)::int AS active_children
       FROM children
       WHERE deleted_at IS NULL`,
    ),
  ])
  return {
    activeParents: Number(parentRow?.active_parents ?? 0),
    deletedParents: Number(parentRow?.deleted_parents ?? 0),
    newParents30d: Number(parentRow?.new_parents_30d ?? 0),
    activeChildren: Number(childRow?.active_children ?? 0),
  }
}

interface SessionTotalsRow {
  total_sessions: number
  sessions_30d: number
  total_help_used: number
}

/**
 * Practice-engagement metrics: total sessions, sessions started in the trailing
 * 30 days, total AI hint usage (`SUM(help_used)`, `COALESCE`d to 0 for an empty
 * table), sessions grouped by status, and review reports grouped by generator.
 * Grouped rows are mapped onto their fixed key sets, defaulting absent keys to
 * `0` (Req 8.1, 8.2, 8.3, 8.4, 8.5).
 */
export async function getEngagementMetrics(): Promise<EngagementMetrics> {
  const [totalsRow, statusRows, reviewRows] = await Promise.all([
    queryOne<SessionTotalsRow>(
      `SELECT
         COUNT(*)::int                                                         AS total_sessions,
         COUNT(*) FILTER (WHERE started_at >= now() - interval '30 days')::int AS sessions_30d,
         COALESCE(SUM(help_used), 0)::int                                      AS total_help_used
       FROM sessions`,
    ),
    query<GroupedCountRow>(
      `SELECT status AS key, COUNT(*)::int AS count
       FROM sessions
       GROUP BY status`,
    ),
    query<GroupedCountRow>(
      `SELECT generated_by AS key, COUNT(*)::int AS count
       FROM review_reports
       GROUP BY generated_by`,
    ),
  ])
  const reviewByGenerator = mapGroupedCounts(reviewRows, ["nova", "fallback"] as const)
  return {
    totalSessions: Number(totalsRow?.total_sessions ?? 0),
    byStatus: mapGroupedCounts(statusRows, SESSION_STATUSES),
    sessions30d: Number(totalsRow?.sessions_30d ?? 0),
    totalHelpUsed: Number(totalsRow?.total_help_used ?? 0),
    reviewReportsByGenerator: {
      nova: reviewByGenerator.nova,
      fallback: reviewByGenerator.fallback,
    },
  }
}

interface ContentTotalsRow {
  total_questions: number
  active_questions: number
  inactive_questions: number
}

/**
 * Question-bank metrics: total / active / inactive counts and counts grouped by
 * topic, mapped onto all topics with absent topics defaulting to `0` (Req 9.1,
 * 9.2, 9.3). The answer-bearing columns `text`, `options`, and `correct_index`
 * are never selected (Req 9.4, 12.4).
 */
export async function getContentMetrics(): Promise<ContentMetrics> {
  const [totalsRow, topicRows] = await Promise.all([
    queryOne<ContentTotalsRow>(
      `SELECT
         COUNT(*)::int                           AS total_questions,
         COUNT(*) FILTER (WHERE active)::int     AS active_questions,
         COUNT(*) FILTER (WHERE NOT active)::int AS inactive_questions
       FROM questions`,
    ),
    query<GroupedCountRow>(
      `SELECT topic AS key, COUNT(*)::int AS count
       FROM questions
       GROUP BY topic`,
    ),
  ])
  return {
    totalQuestions: Number(totalsRow?.total_questions ?? 0),
    activeQuestions: Number(totalsRow?.active_questions ?? 0),
    inactiveQuestions: Number(totalsRow?.inactive_questions ?? 0),
    byTopic: mapGroupedCounts(topicRows, TOPICS),
  }
}

interface WebhookEventRow {
  type: string
  processed_at: string
}

interface AuditLogRow {
  action: string
  created_at: string
}

/**
 * Operational health: the 10 most recent processed webhook events and the 20
 * most recent audit-log entries, each ordered by timestamp descending with an
 * explicit `LIMIT` (Req 10.1, 10.2, 10.3, 10.4, 13.2). The audit query selects
 * only `action` and `created_at` — the raw `detail` payload is deliberately
 * never selected, so it cannot leak PII (Req 10.5, 12.1).
 */
export async function getOperationalMetrics(): Promise<OperationalMetrics> {
  const [webhookRows, auditRows] = await Promise.all([
    query<WebhookEventRow>(
      `SELECT type, processed_at
       FROM processed_webhook_events
       ORDER BY processed_at DESC
       LIMIT 10`,
    ),
    query<AuditLogRow>(
      `SELECT action, created_at
       FROM audit_log
       ORDER BY created_at DESC
       LIMIT 20`,
    ),
  ])
  return {
    recentWebhookEvents: webhookRows.map((r) => ({ type: r.type, processedAt: r.processed_at })),
    recentAuditEntries: auditRows.map((r) => ({ action: r.action, createdAt: r.created_at })),
  }
}

// ---- Concurrent aggregator ----

/**
 * Run every independent metric query concurrently and settle each section on its
 * own, so one failing query degrades only its section instead of blanking the
 * whole page (Req 13.3, 14.3). `Promise.allSettled` never rejects: a rejected
 * query becomes `{ ok: false }` for that section via `settle`, while every other
 * section still resolves to `{ ok: true, data }`. The revenue overview reuses the
 * existing `getRevenueSummary()` helper unchanged (Req 4.5).
 */
export async function getAdminMetrics(): Promise<AdminMetrics> {
  const [revenue, invoices, subscriptions, users, engagement, content, operations] =
    await Promise.allSettled([
      getRevenueSummary(),
      getRecentInvoices(),
      getSubscriptionMetrics(),
      getUserMetrics(),
      getEngagementMetrics(),
      getContentMetrics(),
      getOperationalMetrics(),
    ])
  return {
    revenue: settle(revenue),
    invoices: settle(invoices),
    subscriptions: settle(subscriptions),
    users: settle(users),
    engagement: settle(engagement),
    content: settle(content),
    operations: settle(operations),
  }
}
