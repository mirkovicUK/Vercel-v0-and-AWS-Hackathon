import "server-only"
import { query, queryOne } from "@/lib/aws/rds-data"
import type { ClientQuestion, Question, Topic } from "@/lib/domain"

interface QuestionRow {
  id: string
  text: string
  options: string[]
  correct_index: number
  topic: Topic
  difficulty: number
  image_url: string | null
  image_description: string | null
}

function mapQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    text: row.text,
    options: row.options,
    correctIndex: row.correct_index,
    topic: row.topic,
    difficulty: row.difficulty,
    imageUrl: row.image_url,
    imageDescription: row.image_description,
  }
}

/**
 * ANSWER FIREWALL: strip correctIndex (and the answer-only image description)
 * before a question is ever serialised to the browser during an active session.
 */
export function toClientQuestion(q: Question): ClientQuestion {
  return {
    id: q.id,
    text: q.text,
    options: q.options,
    topic: q.topic,
    difficulty: q.difficulty,
    imageUrl: q.imageUrl,
  }
}

const SELECT = `SELECT id, text, options, correct_index, topic, difficulty, image_url, image_description FROM questions`

export async function getQuestionById(id: string): Promise<Question | null> {
  const row = await queryOne<QuestionRow>(`${SELECT} WHERE id = :id`, { id })
  return row ? mapQuestion(row) : null
}

export async function getQuestionsByIds(ids: string[]): Promise<Question[]> {
  if (ids.length === 0) return []
  // Build a parameterised IN list.
  const params: Record<string, string> = {}
  const placeholders = ids.map((id, i) => {
    params[`id${i}`] = id
    return `:id${i}`
  })
  const rows = await query<QuestionRow>(`${SELECT} WHERE id IN (${placeholders.join(",")})`, params)
  return rows.map(mapQuestion)
}

/**
 * Pick a randomised set of active question ids for a new session.
 * For topic sessions, restricts to a single topic; otherwise mixes all topics.
 */
export async function pickQuestionIds(opts: { count: number; topic?: Topic | null }): Promise<string[]> {
  const where = opts.topic ? `WHERE active AND topic = :topic::topic` : `WHERE active`
  const rows = await query<{ id: string }>(
    `SELECT id FROM questions ${where} ORDER BY random() LIMIT :count`,
    opts.topic ? { topic: opts.topic, count: opts.count } : { count: opts.count },
  )
  return rows.map((r) => r.id)
}

export async function countQuestions(): Promise<number> {
  const row = await queryOne<{ count: number }>(`SELECT count(*)::int AS count FROM questions WHERE active`)
  return row?.count ?? 0
}
