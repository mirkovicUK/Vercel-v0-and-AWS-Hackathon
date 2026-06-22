import "server-only"
import { query } from "@/lib/aws/rds-data"

/**
 * Read-only Insights_Service for the At-Risk Learner Insights admin surface.
 *
 * This module computes two operator-only, **read-only** lifecycle cohorts over
 * the existing Aurora schema — children with a declining recent mastery trend
 * and parents whose trial ends soon — and exposes the typed payloads the admin
 * dashboard renders.
 *
 * Unlike the aggregate, PII-minimal `admin-metrics.ts` service, this surface
 * operates under a **deliberate, documented PII exception** on a legitimate-
 * interest basis of operational support and safeguarding. For this surface only,
 * an admin may see the owning **parent email** and the child's **display name**
 * (the only child identifier the schema collects). Everything else stays
 * forbidden. That exception is encoded **structurally**: the payload item types
 * below carry *only* the permitted fields, so a forbidden attribute (a Cognito
 * `sub`, a `stripe_customer_id`, any other child/parent column, or a question's
 * `text`/`options`/`correct_index`) has no slot to live in — a PII firewall by
 * construction (Req 3.5, 3.6, 5.4, 5.5, 7.1–7.5).
 *
 * The `SELECT`-only cohort query functions and their SQL are added in a later
 * task; this file currently provides the tunable constants, the typed payload
 * contracts, and the pure, in-memory helpers those queries build on. The helpers
 * are deliberately free of I/O so they can be exercised deterministically by the
 * property tests (the `server-only` import is stubbed by the test runner).
 */

// ---- Tunable constants (visible, testable, query-cost bounding) ----

/** Most-recent completed sessions per child over which the slope is computed (Req 2.2). */
export const MASTERY_TREND_WINDOW = 5
/** Minimum completed sessions for a child's slope to be meaningful (Req 2.3, 2.4). */
export const MIN_COMPLETED_SESSIONS = 2
/** Forward-looking trial window in days: [now, now + N days] (Req 4.2). */
export const TRIAL_ENDING_WINDOW_DAYS = 3
/** Explicit per-cohort row cap, bounding query cost (Req 2.6, 4.5, 8.3). */
export const COHORT_ROW_LIMIT = 50

// ---- Raw DB rows (exact SELECT column shapes) ----

/** One row of the declining-mastery cohort SELECT (Req 3.1–3.3). */
export interface DecliningMasteryRow {
  child_display_name: string
  parent_email: string
  mastery_slope: number // strictly negative (filtered in SQL)
}

/** One row of the trials-ending-soon cohort SELECT (Req 5.1, 5.2). */
export interface TrialEndingRow {
  parent_email: string
  trial_end: string // ISO timestamp
}

// ---- Payload items (what the cards render — the type-level PII firewall) ----

/**
 * Declining-mastery payload. The permitted set is *exactly*
 * `{ childDisplayName, parentEmail, masterySlope }`: `childDisplayName` is the
 * only child identifier permitted (Req 3.5, 7.3), `parentEmail` the only parent
 * PII permitted (Req 3.2, 7.1), and `masterySlope` the signed mastery metric
 * (Req 3.3). There is no field for any forbidden attribute.
 */
export interface DecliningMasteryItem {
  childDisplayName: string
  parentEmail: string
  masterySlope: number
}

/**
 * Trials-ending-soon payload. The permitted set is *exactly*
 * `{ parentEmail, daysRemaining, trialEnd }`: `parentEmail` is the only parent
 * PII permitted (Req 5.1, 7.1), `daysRemaining` the non-negative whole days
 * rounded up (Req 5.2), and `trialEnd` the ISO timestamp backing the ordering
 * and display. There is no field for any forbidden attribute.
 */
export interface TrialEndingItem {
  parentEmail: string
  daysRemaining: number
  trialEnd: string
}

// ---- Pure mapping/classification helpers (no I/O — unit/property testable) ----

const ONE_DAY_MS = 86_400_000

/**
 * Net signed change across a windowed cumulative-accuracy series (oldest→newest).
 * Equals `last − first`, which equals the sum of the consecutive `LAG()` deltas
 * (the deltas telescope), reconciling the "signed change" definition with the
 * per-session delta machinery `getImprovementVelocity` uses (Req 2.2, 8.1).
 * Returns `null` for an empty series.
 */
export function recentMasterySlope(cumulativeSeries: number[]): number | null {
  if (cumulativeSeries.length === 0) return null
  return cumulativeSeries[cumulativeSeries.length - 1] - cumulativeSeries[0]
}

/**
 * Cohort membership for the declining-mastery cohort: a strictly-negative,
 * non-null slope AND at least `minSessions` completed sessions in the window
 * (Req 2.3, 2.4). Every other case (null slope, zero/positive slope, or too few
 * sessions) is excluded.
 */
export function qualifiesAsDecliningMastery(
  slope: number | null,
  completedInWindow: number,
  minSessions: number = MIN_COMPLETED_SESSIONS,
): boolean {
  return slope !== null && slope < 0 && completedInWindow >= minSessions
}

/**
 * Render a slope with an explicit leading sign: `"+3"` for a positive value,
 * the native `"-12"` for a negative value, and `"0"` for zero — so every
 * displayed declining slope is unmistakably negative (Req 3.3). `Number()` of
 * the formatted string recovers the original value.
 */
export function formatSignedSlope(slope: number): string {
  if (slope > 0) return `+${slope}`
  return String(slope) // negatives already carry "-"; zero renders "0"
}

/**
 * Trial-window membership against one constant `now`: the status is `trialing`
 * AND `now <= trialEnd <= now + windowDays` (both bounds inclusive). A trial
 * ending exactly on either boundary is included; one strictly before `now` is
 * excluded (Req 4.2, 4.3).
 */
export function inTrialEndingWindow(
  status: string,
  trialEnd: Date,
  now: Date,
  windowDays: number = TRIAL_ENDING_WINDOW_DAYS,
): boolean {
  if (status !== "trialing") return false
  const t = trialEnd.getTime()
  const upper = now.getTime() + windowDays * ONE_DAY_MS
  return t >= now.getTime() && t <= upper
}

/**
 * Whole days until `trialEnd`, rounded **up**, never negative:
 * `max(0, ceil((trialEnd − now) / one day))` (Req 5.2).
 */
export function computeDaysRemaining(trialEnd: string | Date, now: Date): number {
  const ms = new Date(trialEnd).getTime() - now.getTime()
  return Math.max(0, Math.ceil(ms / ONE_DAY_MS))
}

/** Map one declining-mastery row to its payload, narrowed to the permitted fields. */
export function mapDecliningMasteryRow(row: DecliningMasteryRow): DecliningMasteryItem {
  return {
    childDisplayName: row.child_display_name,
    parentEmail: row.parent_email,
    masterySlope: Number(row.mastery_slope),
  }
}

/**
 * Map one trials-ending row to its payload, computing `daysRemaining` against
 * the single constant `now` the cohort computation is evaluated against (Req 4.1, 5.2).
 */
export function mapTrialEndingRow(row: TrialEndingRow, now: Date): TrialEndingItem {
  return {
    parentEmail: row.parent_email,
    trialEnd: row.trial_end,
    daysRemaining: computeDaysRemaining(row.trial_end, now),
  }
}

// ---- Pure ordering/bound helper + comparators (mirror the SQL ORDER BY) ----

/**
 * Order `rows` by `compare` and keep at most `limit` rows. This mirrors the SQL
 * `ORDER BY ... LIMIT :limit` for the in-memory ordering property: with a total,
 * deterministic comparator the result is reproducible across identical inputs,
 * is sorted non-decreasing under `compare`, and the retained rows are exactly
 * the smallest `limit` rows under that order (Req 2.5, 2.6, 4.4, 4.5, 8.3, 8.4).
 */
export function orderAndLimit<T>(
  rows: T[],
  compare: (a: T, b: T) => number,
  limit: number,
): T[] {
  return [...rows].sort(compare).slice(0, Math.max(0, limit))
}

/**
 * Declining-mastery ordering: `masterySlope` ascending (steepest decline first),
 * ties broken by `childDisplayName` then `parentEmail` ascending for a stable,
 * unique, deterministic order mirroring `ORDER BY mastery_slope ASC, display_name
 * ASC, id ASC` (Req 2.5).
 */
export function compareDecliningMastery(a: DecliningMasteryItem, b: DecliningMasteryItem): number {
  if (a.masterySlope !== b.masterySlope) return a.masterySlope - b.masterySlope
  if (a.childDisplayName !== b.childDisplayName) {
    return a.childDisplayName < b.childDisplayName ? -1 : 1
  }
  if (a.parentEmail !== b.parentEmail) return a.parentEmail < b.parentEmail ? -1 : 1
  return 0
}

/**
 * Trials-ending ordering: `trialEnd` ascending (soonest-ending first), ties
 * broken by `parentEmail` ascending for a stable, unique, deterministic order
 * mirroring `ORDER BY trial_end ASC, email ASC, id ASC` (Req 4.4).
 */
export function compareTrialEnding(a: TrialEndingItem, b: TrialEndingItem): number {
  if (a.trialEnd !== b.trialEnd) return a.trialEnd < b.trialEnd ? -1 : 1
  if (a.parentEmail !== b.parentEmail) return a.parentEmail < b.parentEmail ? -1 : 1
  return 0
}

// ---- SELECT-only cohort queries (one engine query per cohort) ----
//
// Both statements below are read-only and issued through the RDS Data API
// `query` helper (Req 6.1, 8.2). Each cohort is computed by a SINGLE SQL
// statement that does its aggregation, window computation, joins, ordering and
// `LIMIT` in Aurora — the application never fetches rows and loops (Req 2.1,
// 8.2, 8.3). No function performs authorization: the gate runs once at the
// `/admin` page boundary, exactly as the Metrics_Service functions do.
//
// Parameter-binding convention (see `lib/aws/rds-data.ts` `toField`): named
// `:param` placeholders are bound from a plain object. Integers bind as
// `longValue` (Postgres `bigint`), so `make_interval(days => …)` — whose `days`
// argument is `integer` — needs an explicit `::int` cast on the bound value. A
// `Date` binds as a `timestamptz`-cast string carrying the `TIMESTAMP` typeHint,
// so a single bound `now` drives both the lower bound and the interval base.

/**
 * Completed-session predicate, matching `lib/db/analytics.ts`'s definition of a
 * completed session (`status IN ('completed','expired')`) and additionally
 * requiring a non-null `completed_at`, so the cohort reuses the same relational
 * definition the per-child analytics use (Req 8.1).
 */
const COMPLETED = `s.status IN ('completed','expired') AND s.completed_at IS NOT NULL`

/**
 * Declining-mastery cohort: `getImprovementVelocity` "turned sideways". In one
 * pass it computes every child's running cumulative-accuracy series, keeps each
 * child's most-recent `:window` completed sessions, reduces each windowed series
 * to a single signed slope (`last_cum − first_cum`, equal to the sum of the
 * telescoping `LAG()` deltas — Req 2.2, 8.1), and returns only the strictly-
 * negative ones for children with at least `:minSessions` completed sessions
 * (Req 2.1, 2.3, 2.4). Ordered steepest-decline-first with a total, deterministic
 * tie-break and an explicit `:limit` (Req 2.5, 2.6, 8.3, 8.4). Only
 * `display_name` and `email` are selected for individuals (Req 3.5, 3.6, 7.3, 7.4).
 */
export const DECLINING_MASTERY_SQL = `WITH per_session AS (
  -- One row per (child, completed session): attempts and correct in that session.
  SELECT s.child_id,
         s.id           AS session_id,
         s.completed_at,
         count(*) FILTER (WHERE sa.is_correct IS NOT NULL) AS attempts,
         count(*) FILTER (WHERE sa.is_correct)             AS correct
  FROM sessions s
  JOIN session_answers sa ON sa.session_id = s.id
  WHERE ${COMPLETED}
  GROUP BY s.child_id, s.id, s.completed_at
),
recent AS (
  -- Rank each child's completed sessions newest-first; keep the most-recent N.
  SELECT *,
         row_number() OVER (PARTITION BY child_id
                            ORDER BY completed_at DESC, session_id DESC) AS rn_desc
  FROM per_session
),
windowed AS (
  -- Within each child's recent window, running cumulative accuracy oldest→newest,
  -- plus the child's ascending position and total windowed-session count.
  SELECT child_id,
         completed_at,
         round(sum(correct) OVER w * 100.0 / NULLIF(sum(attempts) OVER w, 0)) AS cum_pct,
         row_number() OVER w                         AS rn_asc,
         count(*)     OVER (PARTITION BY child_id)    AS window_session_count
  FROM recent
  WHERE rn_desc <= :window
  WINDOW w AS (PARTITION BY child_id ORDER BY completed_at ASC, session_id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
),
slope AS (
  -- Reduce each child's windowed series to last_cum − first_cum (= Σ LAG deltas).
  SELECT child_id,
         window_session_count,
         max(cum_pct) FILTER (WHERE rn_asc = window_session_count)
           - max(cum_pct) FILTER (WHERE rn_asc = 1)   AS mastery_slope
  FROM windowed
  GROUP BY child_id, window_session_count
)
SELECT c.display_name AS child_display_name,
       p.email        AS parent_email,
       sl.mastery_slope
FROM slope sl
JOIN children c ON c.id = sl.child_id AND c.deleted_at IS NULL
JOIN parents  p ON p.id = c.parent_id
WHERE sl.window_session_count >= :minSessions
  AND sl.mastery_slope < 0
ORDER BY sl.mastery_slope ASC,
         c.display_name ASC, c.id ASC
LIMIT :limit`

/**
 * Trials-ending-soon cohort: one `subscriptions` ⋈ `parents` query evaluated
 * against a single request-time instant `:now` reused for both the lower bound
 * and the interval base, so the whole computation sees one constant `now`
 * (Req 4.1). Returns trialing subscriptions whose `trial_end` falls in the
 * closed interval `[now, now + :windowDays days]` (Req 4.2, 4.3), soonest-ending
 * first with a total, deterministic tie-break and an explicit `:limit` (Req 4.4,
 * 4.5, 8.3, 8.4). Only `email` and `trial_end` are selected (Req 5.4, 5.5, 7.1, 7.2).
 */
export const TRIALS_ENDING_SQL = `SELECT p.email     AS parent_email,
       s.trial_end
FROM subscriptions s
JOIN parents p ON p.id = s.parent_id
WHERE s.status = 'trialing'
  AND s.trial_end >= :now
  AND s.trial_end <= :now::timestamptz + make_interval(days => :windowDays::int)
ORDER BY s.trial_end ASC,
         p.email ASC, s.id ASC
LIMIT :limit`

/**
 * Children whose recent mastery trend is strictly negative, steepest-decline
 * first (≤ `COHORT_ROW_LIMIT`). One `SELECT` via the RDS Data API, mapped to the
 * PII-firewalled payload (Req 2.1, 2.5, 2.6, 8.2, 8.3, 8.4).
 */
export async function getDecliningMasteryCohort(): Promise<DecliningMasteryItem[]> {
  const rows = await query<DecliningMasteryRow>(DECLINING_MASTERY_SQL, {
    window: MASTERY_TREND_WINDOW,
    minSessions: MIN_COMPLETED_SESSIONS,
    limit: COHORT_ROW_LIMIT,
  })
  return rows.map(mapDecliningMasteryRow)
}

/**
 * Parents whose trial ends within `TRIAL_ENDING_WINDOW_DAYS`, soonest-ending
 * first (≤ `COHORT_ROW_LIMIT`). The single constant `now` is bound once and also
 * drives the `daysRemaining` computation during mapping (Req 4.1, 4.4, 4.5, 8.2,
 * 8.3, 8.4).
 */
export async function getTrialsEndingSoon(now: Date = new Date()): Promise<TrialEndingItem[]> {
  const rows = await query<TrialEndingRow>(TRIALS_ENDING_SQL, {
    now,
    windowDays: TRIAL_ENDING_WINDOW_DAYS,
    limit: COHORT_ROW_LIMIT,
  })
  return rows.map((r) => mapTrialEndingRow(r, now))
}
