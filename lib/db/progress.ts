import "server-only"
import { query, withTransaction } from "@/lib/aws/rds-data"
import {
  classifyMastery,
  MIN_ATTEMPTS_FOR_CLASSIFICATION,
  TOPICS,
  type MasteryClassification,
  type Topic,
  type TopicProgress,
} from "@/lib/domain"

interface ProgressRow {
  child_id: string
  topic: Topic
  attempts: number
  correct: number
  mastery_score: number
  classification: MasteryClassification
  updated_at: string
}

function mapProgress(row: ProgressRow): TopicProgress {
  return {
    childId: row.child_id,
    topic: row.topic,
    attempts: row.attempts,
    correct: row.correct,
    masteryScore: Number(row.mastery_score),
    classification: row.classification,
    updatedAt: row.updated_at,
  }
}

/**
 * Roll a completed session's answers into per-topic progress. Mastery is a
 * running percentage of correct answers per topic. Idempotent-safe to call once
 * per completed session.
 */
export async function applySessionToProgress(sessionId: string, childId: string): Promise<void> {
  await withTransaction(async (tx) => {
    // Aggregate this session's graded answers by topic.
    const perTopic = await tx.query<{ topic: Topic; attempts: number; correct: number }>(
      `SELECT topic,
              count(*) FILTER (WHERE is_correct IS NOT NULL)::int AS attempts,
              count(*) FILTER (WHERE is_correct)::int AS correct
       FROM session_answers
       WHERE session_id = :sessionId
       GROUP BY topic`,
      { sessionId },
    )
    for (const t of perTopic) {
      if (t.attempts === 0) continue
      // Mastery model: `mastery_score` is kept as a 0-100 percentage so the dashboard/UI
      // (TopicProgress.masteryScore) keeps rendering unchanged. The stored `classification`,
      // however, follows the pinned rules in lib/domain.classifyMastery: it is based on the
      // CUMULATIVE attempts/correct and uses FRACTIONAL thresholds (>=0.8 strong, >=0.5
      // developing, else needs_focus), and yields `insufficient_data` whenever cumulative
      // attempts are below MIN_ATTEMPTS_FOR_CLASSIFICATION. On first insert the cumulative
      // counts equal this session's counts, so the JS-side classifyMastery call is authoritative;
      // on conflict the SQL CASE recomputes from the summed (cumulative) counts.
      await tx.query(
        `INSERT INTO progress (child_id, topic, attempts, correct, mastery_score, classification, updated_at)
         VALUES (:childId, :topic::topic, :attempts, :correct,
                 round((:correct::numeric / NULLIF(:attempts,0)) * 100, 2),
                 :classification::mastery_classification, now())
         ON CONFLICT (child_id, topic) DO UPDATE SET
           attempts = progress.attempts + EXCLUDED.attempts,
           correct  = progress.correct + EXCLUDED.correct,
           mastery_score = round(
             ((progress.correct + EXCLUDED.correct)::numeric
              / NULLIF(progress.attempts + EXCLUDED.attempts, 0)) * 100, 2),
           classification = CASE
             WHEN (progress.attempts + EXCLUDED.attempts) < :minAttempts THEN 'insufficient_data'
             WHEN ((progress.correct + EXCLUDED.correct)::numeric
                   / NULLIF(progress.attempts + EXCLUDED.attempts, 0)) >= 0.8 THEN 'strong'
             WHEN ((progress.correct + EXCLUDED.correct)::numeric
                   / NULLIF(progress.attempts + EXCLUDED.attempts, 0)) >= 0.5 THEN 'developing'
             ELSE 'needs_focus'
           END::mastery_classification,
           updated_at = now()`,
        {
          childId,
          topic: t.topic,
          attempts: t.attempts,
          correct: t.correct,
          minAttempts: MIN_ATTEMPTS_FOR_CLASSIFICATION,
          classification: classifyMastery(t.attempts, t.attempts > 0 ? t.correct / t.attempts : 0),
        },
      )
    }
  })
}

/**
 * Full per-topic progress for a child, with every topic represented (zero-filled
 * when not yet attempted) so the dashboard always shows all six areas.
 */
export async function getChildProgress(childId: string): Promise<TopicProgress[]> {
  const rows = await query<ProgressRow>(
    `SELECT child_id, topic, attempts, correct, mastery_score, classification, updated_at
     FROM progress WHERE child_id = :childId`,
    { childId },
  )
  const byTopic = new Map(rows.map((r) => [r.topic, mapProgress(r)]))
  return TOPICS.map(
    (topic): TopicProgress =>
      byTopic.get(topic) ?? {
        childId,
        topic,
        attempts: 0,
        correct: 0,
        masteryScore: 0,
        // 0 attempts is below MIN_ATTEMPTS_FOR_CLASSIFICATION, so an unattempted
        // topic is "insufficient_data" per the pinned precedence (not "needs_focus").
        classification: "insufficient_data",
        updatedAt: new Date(0).toISOString(),
      },
  )
}

/** The single weakest attempted topic — drives the "focus next" nudge on the dashboard. */
export function weakestTopic(progress: TopicProgress[]): TopicProgress | null {
  const attempted = progress.filter((p) => p.attempts > 0)
  if (attempted.length === 0) return null
  return attempted.reduce((min, p) => (p.masteryScore < min.masteryScore ? p : min))
}

/** Overall mastery across attempted topics, for the child summary card. */
export function overallMastery(progress: TopicProgress[]): number {
  const attempted = progress.filter((p) => p.attempts > 0)
  if (attempted.length === 0) return 0
  const totalCorrect = attempted.reduce((s, p) => s + p.correct, 0)
  const totalAttempts = attempted.reduce((s, p) => s + p.attempts, 0)
  return totalAttempts === 0 ? 0 : Math.round((totalCorrect / totalAttempts) * 100)
}
