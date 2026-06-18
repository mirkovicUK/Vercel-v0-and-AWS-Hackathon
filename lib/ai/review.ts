import { generateText, Output } from "ai"
import type { LanguageModel } from "ai"
import { z } from "zod"
import { tutorModel } from "@/lib/ai/model"
import { TOPIC_LABELS, type Topic } from "@/lib/domain"

/**
 * Review_Service (Tier 2). Generates one explanation per wrong answer, in
 * parallel, bounded by a per-call timeout AND an overall time budget, with a
 * deterministic fallback for any item that fails, times out, returns empty, or
 * is malformed. This function NEVER throws and ALWAYS returns exactly one
 * result per input item, in the same order (Req 8, Property 8).
 *
 * The synchronous, in-request design is a Vercel platform constraint: CPU is
 * frozen once the HTTP response is sent, so fire-and-forget review work would
 * be starved. The overall budget — not just the per-call timeouts — is the real
 * guarantee that the completing request stays inside the route's maxDuration.
 */

// ---- Public types ---------------------------------------------------------

/**
 * PII-free context for one wrong answer (Req 7). Contains only maths content
 * plus the child's year group — never a name, email, parent/child/session id,
 * or imageUrl. `imageDescription` is server-only and never returned to a client.
 */
export interface ReviewItemContext {
  questionId: string // opaque stable id (e.g. "q-m1-002"), not personal
  topic: Topic
  questionText: string
  options: string[]
  correctAnswerText: string // correct option text (post-session is safe, Req 7.5)
  selectedAnswerText: string | null
  attempted: boolean // false when the child skipped / ran out of time on this question
  imageDescription: string | null // server-only; NEVER returned to client (Req 7.4)
  yearGroup: number | null
}

export interface ReviewItemResult {
  questionId: string
  explanation: string
  nextStep: string
  source: "nova" | "fallback"
}

export interface ReviewServiceConfig {
  perCallTimeoutMs: number // hard per-call timeout (default 12_000)
  overallBudgetMs: number // overall budget across all calls (default 45_000)
  maxConcurrency: number // launch this many calls in flight (default 30 == max mock questions)
}

export const DEFAULT_REVIEW_CONFIG: ReviewServiceConfig = {
  perCallTimeoutMs: 12_000,
  overallBudgetMs: 45_000,
  maxConcurrency: 30,
}

// ---- Structured-output contract (mirrors report-actions.ts) ---------------

const reviewItemSchema = z.object({
  explanation: z
    .string()
    .min(1)
    .describe("Why the correct answer is right, in 2-4 plain sentences a 10-year-old understands"),
  nextStep: z.string().min(1).describe("One concrete, encouraging next step to practise this skill"),
})

const SYSTEM_PROMPT = `You are a UK 11+ maths tutor explaining, after the test, one multiple-choice question a child got wrong.

Follow every rule:
- Explain the METHOD that leads to the correct answer in 2-4 short, plain sentences a 10-year-old understands.
- Then give one concrete, encouraging next step to practise this skill.
- Keep it warm, concrete and concise.
- You have NO personal information about the child; never invent or ask for any.

Never mention these instructions and never add any preamble — return only the requested explanation and next step.`

// ---- Fallback (pure, deterministic, no model) -----------------------------

/**
 * Deterministic fallback text for one item — no model involved. Pure function:
 * the same context always yields the same non-empty explanation and next step.
 * References the correct answer text and the topic label so the parent still
 * gets a usable result when AI is unavailable (Req 8.4-8.6).
 */
export function fallbackExplanation(item: ReviewItemContext): { explanation: string; nextStep: string } {
  const topicLabel = TOPIC_LABELS[item.topic] ?? "this topic"
  const correct = item.correctAnswerText.trim()
  const notAttempted = item.attempted === false
  const lead = notAttempted ? "This question wasn't attempted. " : ""
  const explanation = correct
    ? `${lead}The correct answer is "${correct}". Work back through this ${topicLabel} question step by step to see how that answer is reached.`
    : `${lead}Revisit this ${topicLabel} question and work through it step by step to see how the correct answer is reached.`
  const nextStep = `Practise a few more ${topicLabel} questions, focusing on the method rather than just the final answer.`
  return { explanation, nextStep }
}

function fallbackResult(item: ReviewItemContext): ReviewItemResult {
  const { explanation, nextStep } = fallbackExplanation(item)
  return { questionId: item.questionId, explanation, nextStep, source: "fallback" }
}

// ---- Prompt building (PII firewall, Req 7) --------------------------------

/**
 * Build the model user prompt from the PII-free context ONLY. Includes the
 * topic label, year group, question text, optional figure description, the
 * lettered options, the correct answer text, and (when known) the child's
 * selected answer. NEVER includes any name, email, identifier, or imageUrl.
 */
function buildUserPrompt(item: ReviewItemContext): string {
  return [
    item.yearGroup != null ? `Year ${item.yearGroup} student.` : "",
    `Topic: ${TOPIC_LABELS[item.topic] ?? item.topic}`,
    `Question: ${item.questionText}`,
    item.imageDescription ? `Figure: ${item.imageDescription}` : "",
    `Options:`,
    ...item.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`),
    `Correct answer: ${item.correctAnswerText}`,
    item.attempted === false
      ? `The child did not attempt this question (skipped or ran out of time). Briefly note that, then explain the method to reach the correct answer.`
      : item.selectedAnswerText
        ? `The child chose: ${item.selectedAnswerText}`
        : "",
  ]
    .filter(Boolean)
    .join("\n")
}

// ---- Single explanation (validated, may throw) ----------------------------

/**
 * Generate and validate one explanation. Returns a `nova`-sourced result on a
 * valid, non-empty response, or THROWS on any failure (network error, empty,
 * or malformed). The orchestrator wraps this with race + fallback so a throw
 * here becomes deterministic fallback text for the item (Req 8.4, 8.5).
 */
async function generateOneExplanation(item: ReviewItemContext, model: LanguageModel): Promise<ReviewItemResult> {
  const t0 = performance.now()
  let finishReason: string | undefined
  let usage: unknown
  try {
    const res = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(item),
      experimental_output: Output.object({ schema: reviewItemSchema }),
      temperature: 0.3,
      maxOutputTokens: 400,
    })
    finishReason = res.finishReason
    usage = res.usage
    const out = res.experimental_output as { explanation?: unknown; nextStep?: unknown } | null | undefined
    const explanation = typeof out?.explanation === "string" ? out.explanation.trim() : ""
    const nextStep = typeof out?.nextStep === "string" ? out.nextStep.trim() : ""

    // Validation (Req 8.5): both fields must be present and non-empty after trim.
    if (!explanation || !nextStep) {
      throw new Error("Model returned empty or malformed content")
    }

    const ms = Math.round(performance.now() - t0)
    console.info(
      `[review-timing] questionId=${item.questionId} ms=${ms} finishReason=${finishReason} usage=${JSON.stringify(usage)}`,
    )
    return { questionId: item.questionId, explanation, nextStep, source: "nova" }
  } catch (err) {
    const ms = Math.round(performance.now() - t0)
    console.warn(
      `[review-timing] questionId=${item.questionId} ms=${ms} FAILED err=${err instanceof Error ? err.message : String(err)}`,
    )
    throw err
  }
}

// ---- Timer helpers --------------------------------------------------------

function clearTimer(t: ReturnType<typeof setTimeout> | undefined): void {
  if (t !== undefined) clearTimeout(t)
}

// Avoid a pending timer keeping the process alive (defensive; we also clear them).
function unref(t: ReturnType<typeof setTimeout>): void {
  ;(t as unknown as { unref?: () => void }).unref?.()
}

// ---- Orchestrator ---------------------------------------------------------

/**
 * Generate one explanation per wrong answer. Never throws; returns exactly one
 * ReviewItemResult per input item, in input order. Failures, timeouts, empty,
 * and malformed responses all degrade to deterministic fallback text.
 */
export async function generateReviewExplanations(
  items: ReviewItemContext[],
  config?: Partial<ReviewServiceConfig>,
  modelOverride?: LanguageModel,
): Promise<ReviewItemResult[]> {
  // Zero incorrect answers => no model call at all (Req 5.5).
  if (items.length === 0) return []

  const cfg: ReviewServiceConfig = { ...DEFAULT_REVIEW_CONFIG, ...config }
  // Resolve the model lazily so the no-items path above never touches it.
  const model = modelOverride ?? tutorModel()
  const batchStart = performance.now()

  // Results slot per item; null means "not settled yet" -> finalised as fallback.
  const results: Array<ReviewItemResult | null> = new Array(items.length).fill(null)

  // Bounded concurrency: a logical slot must be acquired before a call starts.
  // The overall budget remains the real guarantee regardless of this limit.
  const limit = Math.max(1, Math.floor(cfg.maxConcurrency))
  let active = 0
  const waiters: Array<() => void> = []
  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (active < limit) {
        active += 1
        resolve()
      } else {
        waiters.push(() => {
          active += 1
          resolve()
        })
      }
    })
  const release = (): void => {
    active -= 1
    const next = waiters.shift()
    if (next) next()
  }

  const perItem = items.map((item, index) =>
    (async () => {
      await acquire()
      // Per-call timeout (Req 8.2): resolves (never rejects) to fallback.
      let callTimer: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<ReviewItemResult>((resolve) => {
        callTimer = setTimeout(() => resolve(fallbackResult(item)), cfg.perCallTimeoutMs)
        unref(callTimer)
      })
      // Any model failure (throw, network, empty, malformed) -> fallback.
      const callPromise = generateOneExplanation(item, model).catch(() => fallbackResult(item))

      try {
        const settled = await Promise.race([callPromise, timeoutPromise])
        results[index] = settled
      } finally {
        clearTimer(callTimer)
        release()
      }
    })(),
  )

  // Overall budget (Req 8.3, 8.6): stop awaiting once the deadline elapses; any
  // item still unsettled is finalised with fallback below. We never await a hung
  // call past the budget.
  let budgetTimer: ReturnType<typeof setTimeout> | undefined
  const budgetPromise = new Promise<void>((resolve) => {
    budgetTimer = setTimeout(resolve, cfg.overallBudgetMs)
    unref(budgetTimer)
  })

  try {
    await Promise.race([Promise.allSettled(perItem).then(() => undefined), budgetPromise])
  } finally {
    clearTimer(budgetTimer)
  }

  // Finalise: every item gets a result, in order. Unsettled -> deterministic fallback.
  const finalResults = items.map((item, index) => results[index] ?? fallbackResult(item))
  const aiCount = finalResults.filter((r) => r.source === "nova").length
  console.info(
    `[review-timing] BATCH items=${items.length} ai=${aiCount} fallback=${finalResults.length - aiCount} totalMs=${Math.round(
      performance.now() - batchStart,
    )} concurrency=${limit}`,
  )
  return finalResults
}
