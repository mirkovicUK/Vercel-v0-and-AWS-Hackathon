import "server-only"
import { query, queryOne } from "@/lib/aws/rds-data"
import type { Topic } from "@/lib/domain"

// Whether the AI review has finished generating explanations for every wrong
// answer. A skeleton document is persisted as "pending" before any AI call so
// the result page can render immediately; it flips to "complete" once the
// explanations are merged in.
export type ReviewStatus = "pending" | "complete"

// Provenance of the review explanations: "nova" when at least one explanation
// came from the AI model, "fallback" when every item used deterministic text.
// NOTE: "nova" is a historical sentinel kept for the persisted `generated_by`
// column and the admin dashboard; the model is now Claude Sonnet 4.6.
export type ReviewGeneratedBy = "nova" | "fallback"

// One review entry per wrong answer. Deliberately PII-free and free of any
// `imageDescription` — this document is rendered to the client (Req 7.4).
export interface ReviewItem {
  questionId: string
  explanation: string
  nextStep: string
}

// The persisted, client-renderable review for a completed session. It never
// contains `imageDescription`: this module only persists what it is given, and
// the shape intentionally has no field for it.
// NOTE: declared as a `type` (not an `interface`) deliberately. The whole
// document is passed to the RDS Data API wrapper as a single JSONB parameter,
// whose `ParamValue` object arm is `Record<string, unknown>`. A `type` alias of
// an object shape carries an implicit index signature and is assignable to that;
// an `interface` is not, so an interface here would fail type-checking.
export type ReviewDocument = {
  perTopicSummary: Array<{ topic: Topic; attempted: number; correct: number }>
  strongestTopic: Topic | "n/a"
  weakestTopic: Topic | "n/a"
  items: ReviewItem[]
  status: ReviewStatus
}

interface ReviewRow {
  summary: ReviewDocument
  generated_by: ReviewGeneratedBy
}

/**
 * Idempotently persist a session's review document. The `summary` is passed as
 * a JS object; the rds-data wrapper serialises objects to JSONB (typeHint JSON).
 * Re-running for the same session overwrites the prior document — this is how
 * the skeleton ("pending") document is later replaced by the "complete" one.
 *
 * `id` is omitted: the column has a `gen_random_uuid()::text` default.
 */
export async function upsertReviewReport(input: {
  sessionId: string
  document: ReviewDocument
  generatedBy: ReviewGeneratedBy
}): Promise<void> {
  await query(
    `INSERT INTO review_reports (session_id, summary, generated_by)
     VALUES (:sid, :doc, :by)
     ON CONFLICT (session_id) DO UPDATE SET
       summary = EXCLUDED.summary,
       generated_by = EXCLUDED.generated_by`,
    { sid: input.sessionId, doc: input.document, by: input.generatedBy },
  )
}

/**
 * Fetch the persisted review for a session, or null if none exists yet. The
 * JSONB `summary` column round-trips back to a JS object via the wrapper.
 */
export async function getReviewReport(
  sessionId: string,
): Promise<{ document: ReviewDocument; generatedBy: ReviewGeneratedBy } | null> {
  const row = await queryOne<ReviewRow>(
    `SELECT summary, generated_by FROM review_reports WHERE session_id = :sid`,
    { sid: sessionId },
  )
  if (!row) return null
  return { document: row.summary, generatedBy: row.generated_by }
}
