import "server-only"
import { query } from "@/lib/aws/rds-data"
import { getSessionForParent } from "@/lib/db/sessions"
import { getReviewReport } from "@/lib/db/reviews"
import type { PracticeSession, Topic } from "@/lib/domain"

/**
 * Full, click-through detail for one past session. Reconstructed with a single
 * foreign-key join across the normalised event log:
 *   sessions ─< session_answers >─ questions     (+ the persisted review_reports)
 * plus a per-topic "what did they struggle on" FILTER aggregate computed in SQL
 * (NOT by the model). Nothing is recomputed by AI here — the explanations are the
 * ones already generated and stored when the session finished.
 */

export interface SessionDetailAnswer {
  position: number
  questionId: string
  text: string
  options: string[]
  correctIndex: number
  imageUrl: string | null
  difficulty: number
  topic: Topic
  selectedIndex: number | null
  isCorrect: boolean | null
  answered: boolean
  explanation: string | null
  nextStep: string | null
}

export interface SessionStruggle {
  topic: Topic
  attempted: number
  correct: number
  wrong: number
  skipped: number
  pct: number
}

export interface SessionDetail {
  session: PracticeSession
  answers: SessionDetailAnswer[]
  struggle: SessionStruggle[] // attempted topics, weakest-first
  weakestTopic: Topic | null
  reviewPending: boolean
}

interface DetailRow {
  position: number
  question_id: string
  text: string
  options: string[]
  correct_index: number
  image_url: string | null
  difficulty: number
  topic: Topic
  selected_index: number | null
  is_correct: boolean | null
  answered_at: string | null
}

interface StruggleRow {
  topic: Topic
  attempted: number
  correct: number
  wrong: number
  skipped: number
}

/** Fetch one session's full detail, scoped to the owning parent (defence in depth). */
export async function getSessionDetail(sessionId: string, parentId: string): Promise<SessionDetail | null> {
  const session = await getSessionForParent(sessionId, parentId)
  if (!session) return null

  const [answerRows, struggleRows, review] = await Promise.all([
    query<DetailRow>(
      `SELECT sa.position, sa.selected_index, sa.is_correct, sa.answered_at, sa.topic,
              q.id AS question_id, q.text, q.options, q.correct_index, q.image_url, q.difficulty
       FROM session_answers sa
       JOIN questions q ON q.id = sa.question_id
       WHERE sa.session_id = :sessionId
       ORDER BY sa.position ASC`,
      { sessionId },
    ),
    query<StruggleRow>(
      `SELECT topic,
              count(*) FILTER (WHERE is_correct IS NOT NULL)::int AS attempted,
              count(*) FILTER (WHERE is_correct)::int             AS correct,
              count(*) FILTER (WHERE is_correct = false)::int      AS wrong,
              count(*) FILTER (WHERE answered_at IS NULL)::int     AS skipped
       FROM session_answers
       WHERE session_id = :sessionId
       GROUP BY topic`,
      { sessionId },
    ),
    getReviewReport(sessionId),
  ])

  const explanationByQid = new Map(
    (review?.document.items ?? []).map((i) => [i.questionId, { explanation: i.explanation, nextStep: i.nextStep }]),
  )

  const answers: SessionDetailAnswer[] = answerRows.map((r) => {
    const exp = explanationByQid.get(r.question_id)
    return {
      position: r.position,
      questionId: r.question_id,
      text: r.text,
      options: r.options,
      correctIndex: r.correct_index,
      imageUrl: r.image_url,
      difficulty: r.difficulty,
      topic: r.topic,
      selectedIndex: r.selected_index,
      isCorrect: r.is_correct,
      answered: r.answered_at != null,
      explanation: exp?.explanation ?? null,
      nextStep: exp?.nextStep ?? null,
    }
  })

  const struggle: SessionStruggle[] = struggleRows
    .filter((r) => r.attempted > 0)
    .map((r) => ({ ...r, pct: r.attempted > 0 ? Math.round((r.correct / r.attempted) * 100) : 0 }))
    .sort((a, b) => a.pct - b.pct)

  return {
    session,
    answers,
    struggle,
    weakestTopic: struggle[0]?.topic ?? null,
    reviewPending: review?.document.status === "pending",
  }
}
