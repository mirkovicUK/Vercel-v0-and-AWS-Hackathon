import "server-only"
import { query, type ParamValue } from "@/lib/aws/rds-data"
import { TOPICS, type Topic } from "@/lib/domain"

/**
 * Parent-facing analytics, computed LIVE from the practice event log
 * (`sessions` + `session_answers` + `questions`) over the RDS Data API.
 *
 * These are deliberately relational workloads — window functions (running
 * cumulative accuracy, LAG deltas), multi-table joins (answers × questions for
 * difficulty), and FILTER aggregates (correct / wrong / skipped) — the kind of
 * ad-hoc analytical querying Aurora PostgreSQL does in a single round trip and a
 * key-value store cannot. The denormalised `progress` rollup powers the instant
 * dashboard; this module powers the richer history views from the same event log.
 */

const COMPLETED = `s.status IN ('completed','expired')`

// ---- 1. Mastery over time — time-bucketed, range-aware ---------------------

/** Selectable history window for the mastery chart. */
export type TimelineRange = "30d" | "3m" | "all"

/** A topic line is only plotted once it has at least this many attempts in the
 *  range — below it the sample is too small to be meaningful (mirrors the
 *  `insufficient_data` classification floor on the `progress` rollup). */
const TIMELINE_MIN_ATTEMPTS = 10

const RANGE_CONFIG: Record<TimelineRange, { bucket: "day" | "week" | "month"; days: number | null }> = {
  "30d": { bucket: "day", days: 30 },
  "3m": { bucket: "week", days: 92 },
  all: { bucket: "month", days: null },
}

export interface MasteryTimelinePoint {
  /** ISO timestamp of the start of the bucket (day / week / month). */
  date: string
  /** Overall accuracy (0-100) across all topics IN THIS BUCKET, or null. */
  overall?: number | null
  /** Per-topic accuracy (0-100) IN THIS BUCKET; only topics that clear the
   *  attempt floor over the range appear. */
  values: Partial<Record<Topic, number>>
}

export interface MasteryTimeline {
  range: TimelineRange
  bucket: "day" | "week" | "month"
  points: MasteryTimelinePoint[]
  /** Topics with enough attempts in the range to plot (the chart's chips). */
  topics: Topic[]
}

interface BucketRow {
  bucket: string
  topic: Topic
  attempts: number
  correct: number
}

/**
 * Accuracy per topic per time-bucket over the selected range. Unlike a raw
 * per-session series (which grows unbounded and flattens as a lifetime average),
 * this groups answers into day/week/month buckets in SQL via `date_trunc`, so
 * the chart stays legible at any history length and each point reflects recent
 * form. Bucketing + aggregation happen in Aurora; only ~4-30 points cross the
 * wire. A per-bucket overall accuracy is included for the default single line.
 */
export async function getMasteryTimeline(
  childId: string,
  range: TimelineRange = "30d",
): Promise<MasteryTimeline> {
  const cfg = RANGE_CONFIG[range]
  const sinceClause = cfg.days != null ? "AND s.completed_at >= now() - make_interval(days => :since::int)" : ""
  const params: Record<string, ParamValue> = { childId, bucket: cfg.bucket }
  if (cfg.days != null) params.since = cfg.days

  const rows = await query<BucketRow>(
    `SELECT date_trunc(:bucket, s.completed_at) AS bucket,
            sa.topic,
            count(*) FILTER (WHERE sa.is_correct IS NOT NULL)::int AS attempts,
            count(*) FILTER (WHERE sa.is_correct)::int             AS correct
     FROM sessions s
     JOIN session_answers sa ON sa.session_id = s.id
     WHERE s.child_id = :childId AND ${COMPLETED} AND s.completed_at IS NOT NULL
       ${sinceClause}
     GROUP BY 1, 2
     ORDER BY 1 ASC`,
    params,
  )

  // Topics that clear the attempt floor over the whole range are plottable.
  const totalByTopic = new Map<Topic, number>()
  for (const r of rows) totalByTopic.set(r.topic, (totalByTopic.get(r.topic) ?? 0) + r.attempts)
  const topics = TOPICS.filter((t) => (totalByTopic.get(t) ?? 0) >= TIMELINE_MIN_ATTEMPTS)
  const plottable = new Set(topics)

  // Group rows into one point per bucket: per-bucket overall + per-topic pct.
  const byBucket = new Map<string, { correct: number; attempts: number; values: Partial<Record<Topic, number>> }>()
  for (const r of rows) {
    if (r.attempts === 0) continue
    const b = byBucket.get(r.bucket) ?? { correct: 0, attempts: 0, values: {} }
    b.correct += r.correct
    b.attempts += r.attempts
    if (plottable.has(r.topic)) b.values[r.topic] = Math.round((r.correct * 100) / r.attempts)
    byBucket.set(r.bucket, b)
  }

  const points: MasteryTimelinePoint[] = [...byBucket.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, b]) => ({
      date,
      overall: b.attempts > 0 ? Math.round((b.correct * 100) / b.attempts) : null,
      values: b.values,
    }))

  return { range, bucket: cfg.bucket, points, topics }
}

// ---- 2. Accuracy by difficulty — JOIN answers × questions ------------------

export interface DifficultyAccuracy {
  difficulty: number // 1-5
  attempts: number
  correct: number
  pct: number
}

export async function getAccuracyByDifficulty(childId: string): Promise<DifficultyAccuracy[]> {
  const rows = await query<{ difficulty: number; attempts: number; correct: number }>(
    `SELECT q.difficulty,
            count(*) FILTER (WHERE sa.is_correct IS NOT NULL)::int AS attempts,
            count(*) FILTER (WHERE sa.is_correct)::int             AS correct
     FROM session_answers sa
     JOIN sessions s  ON s.id = sa.session_id
     JOIN questions q ON q.id = sa.question_id
     WHERE s.child_id = :childId AND ${COMPLETED} AND sa.is_correct IS NOT NULL
     GROUP BY q.difficulty
     ORDER BY q.difficulty ASC`,
    { childId },
  )
  return rows.map((r) => ({
    difficulty: r.difficulty,
    attempts: r.attempts,
    correct: r.correct,
    pct: r.attempts > 0 ? Math.round((r.correct / r.attempts) * 100) : 0,
  }))
}

// ---- 3. Correct / wrong / skipped per topic — FILTER aggregates ------------

export interface TopicBreakdown {
  topic: Topic
  correct: number
  wrong: number
  skipped: number
}

export async function getTopicBreakdown(childId: string): Promise<TopicBreakdown[]> {
  const rows = await query<{ topic: Topic; correct: number; wrong: number; skipped: number }>(
    `SELECT sa.topic,
            count(*) FILTER (WHERE sa.is_correct)             ::int AS correct,
            count(*) FILTER (WHERE sa.is_correct = false)     ::int AS wrong,
            count(*) FILTER (WHERE sa.answered_at IS NULL)    ::int AS skipped
     FROM session_answers sa
     JOIN sessions s ON s.id = sa.session_id
     WHERE s.child_id = :childId AND ${COMPLETED}
     GROUP BY sa.topic`,
    { childId },
  )
  const byTopic = new Map(rows.map((r) => [r.topic, r]))
  // Zero-fill all six topics so the chart always shows the full curriculum.
  return TOPICS.map((topic) => byTopic.get(topic) ?? { topic, correct: 0, wrong: 0, skipped: 0 })
}

// ---- 4. Improvement velocity — LAG() over sessions -------------------------

export interface VelocityPoint {
  date: string
  cumulativePct: number
  delta: number | null // change vs the previous completed session
}

export interface ImprovementVelocity {
  current: number // latest overall cumulative accuracy
  lastDelta: number | null // change from the previous session
  series: VelocityPoint[] // for a sparkline
}

export async function getImprovementVelocity(childId: string): Promise<ImprovementVelocity> {
  const rows = await query<{ completed_at: string; cum_pct: number; delta: number | null }>(
    `WITH per_session AS (
       SELECT s.completed_at,
              count(*) FILTER (WHERE sa.is_correct IS NOT NULL) AS attempts,
              count(*) FILTER (WHERE sa.is_correct)             AS correct
       FROM sessions s
       JOIN session_answers sa ON sa.session_id = s.id
       WHERE s.child_id = :childId AND ${COMPLETED} AND s.completed_at IS NOT NULL
       GROUP BY s.completed_at
     ),
     cumulative AS (
       SELECT completed_at,
              round(sum(correct) OVER w * 100.0 / NULLIF(sum(attempts) OVER w, 0))::int AS cum_pct
       FROM per_session
       WINDOW w AS (ORDER BY completed_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
     )
     SELECT completed_at,
            cum_pct,
            (cum_pct - LAG(cum_pct) OVER (ORDER BY completed_at))::int AS delta
     FROM cumulative
     ORDER BY completed_at ASC`,
    { childId },
  )
  const series: VelocityPoint[] = rows.map((r) => ({
    date: r.completed_at,
    cumulativePct: r.cum_pct,
    delta: r.delta,
  }))
  const latest = series[series.length - 1]
  return {
    current: latest?.cumulativePct ?? 0,
    lastDelta: latest?.delta ?? null,
    series,
  }
}

// ---- Per-topic momentum (derived from the timeline) ------------------------

export interface TopicMomentum {
  topic: Topic
  current: number // latest cumulative accuracy
  delta: number // change vs the previous point that topic had
}

/**
 * Most recent change in cumulative accuracy per topic, derived from the mastery
 * timeline (latest vs the prior distinct value for that topic). Lets the AI
 * report say which topics are climbing or stalling, not just where they stand.
 */
export function topicMomentumFromTimeline(points: MasteryTimelinePoint[]): TopicMomentum[] {
  const lastTwo = new Map<Topic, number[]>()
  for (const p of points) {
    for (const [topic, value] of Object.entries(p.values) as [Topic, number][]) {
      const arr = lastTwo.get(topic) ?? []
      // Only push when the value actually changes, so "delta" reflects real movement.
      if (arr.length === 0 || arr[arr.length - 1] !== value) arr.push(value)
      if (arr.length > 2) arr.shift()
      lastTwo.set(topic, arr)
    }
  }
  const out: TopicMomentum[] = []
  for (const [topic, arr] of lastTwo) {
    const current = arr[arr.length - 1]!
    const prev = arr.length > 1 ? arr[0]! : current
    out.push({ topic, current, delta: current - prev })
  }
  return out
}
