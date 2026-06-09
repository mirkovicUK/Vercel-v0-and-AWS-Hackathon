import "server-only"
import { query, queryOne, withTransaction } from "@/lib/aws/rds-data"
import type { PracticeSession, SessionAnswer, SessionStatus, SessionType, Topic } from "@/lib/domain"

interface SessionRow {
  id: string
  child_id: string
  parent_id: string
  type: SessionType
  topic: Topic | null
  question_ids: string[]
  status: SessionStatus
  started_at: string
  expires_at: string
  completed_at: string | null
  time_limit_seconds: number
  help_used: number
  score: number | null
  total: number
}

interface AnswerRow {
  id: string
  session_id: string
  question_id: string
  position: number
  selected_index: number | null
  is_correct: boolean | null
  topic: Topic
  answered_at: string | null
}

function mapSession(row: SessionRow): PracticeSession {
  return {
    id: row.id,
    childId: row.child_id,
    parentId: row.parent_id,
    type: row.type,
    topic: row.topic,
    questionIds: row.question_ids,
    status: row.status,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    timeLimitSeconds: row.time_limit_seconds,
    helpUsed: row.help_used,
    score: row.score,
    total: row.total,
  }
}

function mapAnswer(row: AnswerRow): SessionAnswer {
  return {
    id: row.id,
    sessionId: row.session_id,
    questionId: row.question_id,
    position: row.position,
    selectedIndex: row.selected_index,
    isCorrect: row.is_correct,
    topic: row.topic,
    answeredAt: row.answered_at,
  }
}

const SESSION_COLS = `id, child_id, parent_id, type, topic, question_ids, status,
  started_at, expires_at, completed_at, time_limit_seconds, help_used, score, total`

/**
 * Create a session and pre-seed the ordered answer slots inside one transaction,
 * so the session and its question slots are always consistent.
 */
export async function createSession(input: {
  childId: string
  parentId: string
  type: SessionType
  topic: Topic | null
  questionIds: string[]
  questionTopics: Topic[] // topic per question id, same order
  timeLimitSeconds: number
}): Promise<PracticeSession> {
  return withTransaction(async (tx) => {
    const expiresAtSql = `now() + (:secs::int * interval '1 second')`
    const created = await tx.query<SessionRow>(
      `INSERT INTO sessions (child_id, parent_id, type, topic, question_ids, status, expires_at, time_limit_seconds, total)
       VALUES (:childId, :parentId, :type::session_type, ${input.topic ? ":topic::topic" : "NULL"}, :questionIds::jsonb, 'active', ${expiresAtSql}, :secs, :total)
       RETURNING ${SESSION_COLS}`,
      {
        childId: input.childId,
        parentId: input.parentId,
        type: input.type,
        ...(input.topic ? { topic: input.topic } : {}),
        questionIds: input.questionIds,
        secs: input.timeLimitSeconds,
        total: input.questionIds.length,
      },
    )
    const session = created[0]
    for (let i = 0; i < input.questionIds.length; i++) {
      await tx.query(
        `INSERT INTO session_answers (session_id, question_id, position, topic)
         VALUES (:sessionId, :questionId, :position, :topic::topic)`,
        {
          sessionId: session.id,
          questionId: input.questionIds[i],
          position: i,
          topic: input.questionTopics[i],
        },
      )
    }
    return mapSession(session)
  })
}

/**
 * Pure predicate mirroring the production "active" rule used by `getActiveSession`
 * (`status = 'active' AND now() <= expires_at`) and the `uniq_active_session_per_child`
 * partial unique index / `startSessionAction` guard. A session occupies the single
 * per-child active slot iff it is in status `active` and has not yet expired (Req 4.4).
 *
 * Kept minimal and side-effect-free so the invariant can be tested directly.
 */
export function isSessionActive(status: SessionStatus, expiresAt: string | Date, now: Date): boolean {
  return status === "active" && now.getTime() <= new Date(expiresAt).getTime()
}

/** The single active, non-expired session for a child, or null (Req 4.4). */
export async function getActiveSession(childId: string, parentId: string): Promise<PracticeSession | null> {
  const row = await queryOne<SessionRow>(
    `SELECT ${SESSION_COLS} FROM sessions
     WHERE child_id = :childId AND parent_id = :parentId
       AND status = 'active' AND now() <= expires_at
     ORDER BY started_at DESC LIMIT 1`,
    { childId, parentId },
  )
  return row ? mapSession(row) : null
}

/** End an active session by moving it to a terminal status (Req 4.5). */
export async function endSession(sessionId: string, parentId: string): Promise<PracticeSession | null> {
  const row = await queryOne<SessionRow>(
    `UPDATE sessions SET status = 'abandoned', completed_at = now()
     WHERE id = :sessionId AND parent_id = :parentId AND status = 'active'
     RETURNING ${SESSION_COLS}`,
    { sessionId, parentId },
  )
  return row ? mapSession(row) : null
}

/** Fetch a session scoped to the owning parent (defence-in-depth ownership check). */
export async function getSessionForParent(sessionId: string, parentId: string): Promise<PracticeSession | null> {
  const row = await queryOne<SessionRow>(
    `SELECT ${SESSION_COLS} FROM sessions WHERE id = :sessionId AND parent_id = :parentId`,
    { sessionId, parentId },
  )
  return row ? mapSession(row) : null
}

export async function getSessionAnswers(sessionId: string): Promise<SessionAnswer[]> {
  const rows = await query<AnswerRow>(
    `SELECT id, session_id, question_id, position, selected_index, is_correct, topic, answered_at
     FROM session_answers WHERE session_id = :sessionId ORDER BY position ASC`,
    { sessionId },
  )
  return rows.map(mapAnswer)
}

/**
 * Record an answer. Correctness is computed server-side by the caller (which
 * holds the question's correctIndex) and passed in — the client never sends it.
 * Only writes if the slot is still unanswered, so re-submits are idempotent.
 */
export async function recordAnswer(input: {
  sessionId: string
  position: number
  selectedIndex: number
  isCorrect: boolean
}): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE session_answers
     SET selected_index = :selectedIndex, is_correct = :isCorrect, answered_at = now()
     WHERE session_id = :sessionId AND position = :position AND answered_at IS NULL
     RETURNING id`,
    input,
  )
  return rows.length > 0
}

export async function incrementHelpUsed(sessionId: string): Promise<number> {
  const row = await queryOne<{ help_used: number }>(
    `UPDATE sessions SET help_used = help_used + 1 WHERE id = :sessionId RETURNING help_used`,
    { sessionId },
  )
  return row?.help_used ?? 0
}

/** Finalise a session: compute score from recorded answers and set terminal status. */
export async function completeSession(sessionId: string, status: Extract<SessionStatus, "completed" | "expired">) {
  return withTransaction(async (tx) => {
    const scoreRow = await tx.query<{ score: number }>(
      `SELECT count(*) FILTER (WHERE is_correct)::int AS score FROM session_answers WHERE session_id = :sessionId`,
      { sessionId },
    )
    const score = scoreRow[0]?.score ?? 0
    const updated = await tx.query<SessionRow>(
      `UPDATE sessions SET status = :status::session_status, score = :score, completed_at = now()
       WHERE id = :sessionId AND status = 'active'
       RETURNING ${SESSION_COLS}`,
      { sessionId, status, score },
    )
    return updated[0] ? mapSession(updated[0]) : null
  })
}

/** Recent completed sessions for a child, for the dashboard activity feed. */
export async function getRecentSessions(childId: string, limit = 10): Promise<PracticeSession[]> {
  const rows = await query<SessionRow>(
    `SELECT ${SESSION_COLS} FROM sessions
     WHERE child_id = :childId AND status IN ('completed','expired')
     ORDER BY completed_at DESC NULLS LAST LIMIT :limit`,
    { childId, limit },
  )
  return rows.map(mapSession)
}

/** Mark stale active sessions (past expiry) as expired — called lazily on access. */
export async function expireIfElapsed(sessionId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE sessions SET status = 'expired'
     WHERE id = :sessionId AND status = 'active' AND now() > expires_at
     RETURNING id`,
    { sessionId },
  )
  return rows.length > 0
}

/**
 * Expire ALL elapsed active sessions for a child in one statement.
 *
 * The partial unique index `uniq_active_session_per_child` counts any row with
 * status='active' regardless of expiry, while getActiveSession only returns
 * non-expired ones. A session that timed out but was never flipped becomes a
 * "zombie": invisible to the guard yet still blocking a new INSERT. Sweeping
 * elapsed active rows for the child before creating clears that deadlock.
 * Returns the number of rows expired.
 */
export async function expireElapsedForChild(childId: string, parentId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE sessions SET status = 'expired'
     WHERE child_id = :childId AND parent_id = :parentId
       AND status = 'active' AND now() > expires_at
     RETURNING id`,
    { childId, parentId },
  )
  return rows.length
}
