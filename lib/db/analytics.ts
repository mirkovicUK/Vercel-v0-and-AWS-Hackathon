import "server-only"
import { query } from "@/lib/aws/rds-data"
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

// ---- 1. Mastery over time (6 topics) — window functions --------------------

export interface MasteryTimelinePoint {
  /** ISO timestamp of the session that produced this point. */
  date: string
  /** Cumulative accuracy (0-100) per topic AS OF this session; null until a
   *  topic has been attempted at least once. */
  values: Partial<Record<Topic, number>>
}

interface TimelineRow {
  completed_at: string
  topic: Topic
  cumulative_pct: number
}

/**
 * Cumulative accuracy per topic after each completed session, in chronological
 * order. Uses a window function (PARTITION BY topic ORDER BY time) to compute a
 * running correct/attempts ratio — i.e. "mastery as it was at each point in
 * time", which the snapshot `progress` table cannot give us.
 */
export async function getMasteryTimeline(childId: string): Promise<MasteryTimelinePoint[]> {
  const rows = await query<TimelineRow>(
    `WITH per_session_topic AS (
       SELECT s.completed_at, sa.topic,
              count(*) FILTER (WHERE sa.is_correct IS NOT NULL) AS attempts,
              count(*) FILTER (WHERE sa.is_correct)             AS correct
       FROM sessions s
       JOIN session_answers sa ON sa.session_id = s.id
       WHERE s.child_id = :childId AND ${COMPLETED} AND s.completed_at IS NOT NULL
       GROUP BY s.completed_at, sa.topic
     )
     SELECT completed_at,
            topic,
            round(
              sum(correct) OVER w * 100.0 / NULLIF(sum(attempts) OVER w, 0)
            )::int AS cumulative_pct
     FROM per_session_topic
     WHERE attempts > 0
     WINDOW w AS (PARTITION BY topic ORDER BY completed_at
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
     ORDER BY completed_at ASC`,
    { childId },
  )

  // Pivot into one point per distinct session time, carrying each topic's last
  // known cumulative value forward so lines stay continuous between sessions.
  const points: MasteryTimelinePoint[] = []
  const last: Partial<Record<Topic, number>> = {}
  let current: MasteryTimelinePoint | null = null
  for (const r of rows) {
    if (!current || current.date !== r.completed_at) {
      current = { date: r.completed_at, values: { ...last } }
      points.push(current)
    }
    last[r.topic] = r.cumulative_pct
    current.values[r.topic] = r.cumulative_pct
  }
  return points
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
