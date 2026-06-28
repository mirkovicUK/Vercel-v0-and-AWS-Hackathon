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

/** Time window for the chart's range selector (the data FILTER); the bucket
 *  granularity is then chosen from the actual data span, not fixed. */
const RANGE_DAYS: Record<TimelineRange, number | null> = { "30d": 30, "3m": 92, all: null }

/** Bucket granularity. "session" is the per-session fallback for very short
 *  spans, so a single sitting still draws more than one point. */
type Bucket = "session" | "day" | "week" | "month"

export interface MasteryTimelinePoint {
  /** ISO timestamp representing the bucket (its earliest session). */
  date: string
  /** Overall accuracy (0-100) across all topics IN THIS BUCKET, or null. */
  overall?: number | null
  /** Per-topic accuracy (0-100) IN THIS BUCKET; only topics that clear the
   *  attempt floor over the range appear. */
  values: Partial<Record<Topic, number>>
}

export interface MasteryTimeline {
  range: TimelineRange
  bucket: Bucket
  points: MasteryTimelinePoint[]
  /** Topics with enough attempts in the range to plot (the chart's chips). */
  topics: Topic[]
}

interface SessionTopicRow {
  completed_at: string
  topic: Topic
  attempts: number
  correct: number
}

const DAY_MS = 86_400_000

/** Pick a bucket size from the data's actual span so the chart neither collapses
 *  to one point (e.g. three weeks of data under monthly buckets) nor overcrowds
 *  (a year under daily buckets). */
function chooseBucket(spanDays: number): Bucket {
  if (spanDays <= 2) return "session"
  if (spanDays <= 14) return "day"
  if (spanDays <= 120) return "week"
  return "month"
}

/** A sortable key that collapses a timestamp into its bucket. */
function bucketKeyOf(d: Date, bucket: Bucket): string {
  if (bucket === "session") return d.toISOString()
  if (bucket === "month") return d.toISOString().slice(0, 7) // YYYY-MM
  if (bucket === "day") return d.toISOString().slice(0, 10) // YYYY-MM-DD
  // week: ISO week starting Monday
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const mondayOffset = (dt.getUTCDay() + 6) % 7
  dt.setUTCDate(dt.getUTCDate() - mondayOffset)
  return dt.toISOString().slice(0, 10)
}

/**
 * Accuracy per topic per time-bucket over the selected range, plus a per-bucket
 * overall line. Unlike a raw per-session series (which grows unbounded and
 * flattens into a lifetime average), this buckets answers by period so the chart
 * stays legible at any history length and each point reflects recent form. The
 * bucket size adapts to the data's actual span (per-session → day → week →
 * month), so a 3-week demo, a single sitting, and a year of history all render
 * with a sensible number of points. Aggregation runs in Aurora (the GROUP BY);
 * bucketing is applied in app code so it can adapt to the span.
 */
export async function getMasteryTimeline(
  childId: string,
  range: TimelineRange = "30d",
): Promise<MasteryTimeline> {
  const days = RANGE_DAYS[range]
  const sinceClause = days != null ? "AND s.completed_at >= now() - make_interval(days => :since::int)" : ""
  const params: Record<string, ParamValue> = { childId }
  if (days != null) params.since = days

  const rows = await query<SessionTopicRow>(
    `SELECT s.completed_at,
            sa.topic,
            count(*) FILTER (WHERE sa.is_correct IS NOT NULL)::int AS attempts,
            count(*) FILTER (WHERE sa.is_correct)::int             AS correct
     FROM sessions s
     JOIN session_answers sa ON sa.session_id = s.id
     WHERE s.child_id = :childId AND ${COMPLETED} AND s.completed_at IS NOT NULL
       ${sinceClause}
     GROUP BY s.completed_at, sa.topic
     ORDER BY s.completed_at ASC`,
    params,
  )

  // Topics that clear the attempt floor over the whole range are plottable.
  const totalByTopic = new Map<Topic, number>()
  for (const r of rows) totalByTopic.set(r.topic, (totalByTopic.get(r.topic) ?? 0) + r.attempts)
  const topics = TOPICS.filter((t) => (totalByTopic.get(t) ?? 0) >= TIMELINE_MIN_ATTEMPTS)
  const plottable = new Set(topics)

  // Span-adaptive bucket, but never COARSER than the selected range allows, so
  // 30 days is always daily, 3 months weekly, and All adapts to full history.
  // (Short spans may still go finer — e.g. a single day of sessions -> session.)
  const BUCKET_ORDER: Bucket[] = ["session", "day", "week", "month"]
  const MAX_BUCKET: Record<TimelineRange, Bucket> = { "30d": "day", "3m": "week", all: "month" }
  const times = rows.filter((r) => r.attempts > 0).map((r) => new Date(r.completed_at).getTime())
  const spanDays = times.length > 0 ? (Math.max(...times) - Math.min(...times)) / DAY_MS : 0
  const bucket =
    BUCKET_ORDER[Math.min(BUCKET_ORDER.indexOf(chooseBucket(spanDays)), BUCKET_ORDER.indexOf(MAX_BUCKET[range]))]

  // Bucket → { earliest date, overall correct/attempts, per-topic correct/attempts }.
  interface Agg {
    date: string
    correct: number
    attempts: number
    topics: Map<Topic, { correct: number; attempts: number }>
  }
  const byBucket = new Map<string, Agg>()
  for (const r of rows) {
    if (r.attempts === 0) continue
    const key = bucketKeyOf(new Date(r.completed_at), bucket)
    let b = byBucket.get(key)
    if (!b) {
      b = { date: r.completed_at, correct: 0, attempts: 0, topics: new Map() }
      byBucket.set(key, b)
    }
    if (r.completed_at < b.date) b.date = r.completed_at
    b.correct += r.correct
    b.attempts += r.attempts
    if (plottable.has(r.topic)) {
      const e = b.topics.get(r.topic) ?? { correct: 0, attempts: 0 }
      e.correct += r.correct
      e.attempts += r.attempts
      b.topics.set(r.topic, e)
    }
  }

  const points: MasteryTimelinePoint[] = [...byBucket.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((b) => {
      const values: Partial<Record<Topic, number>> = {}
      for (const [topic, e] of b.topics) {
        if (e.attempts > 0) values[topic] = Math.round((e.correct * 100) / e.attempts)
      }
      return {
        date: b.date,
        overall: b.attempts > 0 ? Math.round((b.correct * 100) / b.attempts) : null,
        values,
      }
    })

  return { range, bucket, points, topics }
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
