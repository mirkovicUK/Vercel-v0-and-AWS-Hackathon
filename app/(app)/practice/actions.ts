"use server"

import { z } from "zod"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { requireEntitledParent } from "@/lib/auth/guard"
import { getChildForParent } from "@/lib/db/children"
import {
  createSession,
  getActiveSession,
  endSession,
  getSessionForParent,
  getSessionAnswers,
  recordAnswer,
  completeSession,
  expireIfElapsed,
  expireElapsedForChild,
} from "@/lib/db/sessions"
import { getQuestionById, getQuestionsByIds, pickQuestionIds } from "@/lib/db/questions"
import { applySessionToProgress } from "@/lib/db/progress"
import { upsertReviewReport, type ReviewDocument, type ReviewItem, type ReviewGeneratedBy } from "@/lib/db/reviews"
import { generateReviewExplanations, fallbackExplanation, type ReviewItemContext } from "@/lib/ai/review"
import { audit } from "@/lib/db/audit"
import {
  SESSION_TYPE_CONFIG,
  TOPICS,
  computePerTopicSummary,
  strongestWeakest,
  type SessionType,
  type Topic,
} from "@/lib/domain"

// The completing request runs the synchronous AI review inline. The Review
// Service is bounded by a 45s overall budget; 60s gives headroom for the
// initial score/summary persist plus the redirect (Req 8.7, 8.8).


const startSchema = z.object({
  childId: z.string().uuid("Invalid child."),
  type: z.enum(["warmup", "topic", "mock"]),
  topic: z.enum(TOPICS).optional(),
})

/** Create a new practice session and route into the player. */
export async function startSessionAction(
  formData: FormData,
): Promise<{ error: string } | { activeSession: { id: string; childId: string } } | void> {
  const { parent } = await requireEntitledParent()
  const parsed = startSchema.safeParse({
    childId: formData.get("childId"),
    type: formData.get("type"),
    topic: formData.get("topic") || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request." }

  const child = await getChildForParent(parsed.data.childId, parent.id)
  if (!child) return { error: "We couldn't find that child profile." }

  // Clear any "zombie" sessions first: an active row whose timer already elapsed
  // is invisible to getActiveSession but still occupies the partial unique index
  // `uniq_active_session_per_child`, which would otherwise block the new INSERT.
  await expireElapsedForChild(child.id, parent.id)

  // One-active-session-per-child guard (Req 4.1–4.4). Check before creating
  // anything. A genuinely expired session is flipped to terminal first so it
  // never blocks a new start.
  const existing = await getActiveSession(child.id, parent.id)
  if (existing) {
    await expireIfElapsed(existing.id)
    const stillActive = await getActiveSession(child.id, parent.id)
    if (stillActive) {
      return { activeSession: { id: stillActive.id, childId: child.id } }
    }
  }

  const config = SESSION_TYPE_CONFIG[parsed.data.type as SessionType]
  const topic: Topic | null = parsed.data.type === "topic" ? parsed.data.topic ?? null : null
  if (parsed.data.type === "topic" && !topic) return { error: "Please choose a topic to practise." }

  const questionIds = await pickQuestionIds({ count: config.questionCount, topic })
  if (questionIds.length === 0) {
    return { error: "No questions are available yet. Please seed the question bank first." }
  }

  // Resolve each question's topic (needed for per-topic progress) without leaking answers.
  const questions = await getQuestionsByIds(questionIds)
  const topicById = new Map(questions.map((q) => [q.id, q.topic]))
  const orderedIds = questionIds.filter((id) => topicById.has(id))
  const questionTopics = orderedIds.map((id) => topicById.get(id)!)

  let session: Awaited<ReturnType<typeof createSession>>
  try {
    session = await createSession({
      childId: child.id,
      parentId: parent.id,
      type: parsed.data.type as SessionType,
      topic,
      questionIds: orderedIds,
      questionTopics,
      timeLimitSeconds: config.timeLimitSeconds,
    })
  } catch (err) {
    // Backstop for a concurrent double-submit: the partial unique index
    // `uniq_active_session_per_child` rejects the second active INSERT. Surface
    // it as the existing active session (resume/end) rather than a 500.
    const message = err instanceof Error ? err.message : String(err)
    if (/uniq_active_session_per_child|unique/i.test(message)) {
      const active = await getActiveSession(child.id, parent.id)
      return { activeSession: { id: active?.id ?? "", childId: child.id } }
    }
    throw err
  }
  await audit({
    action: "session.started",
    parentId: parent.id,
    detail: { sessionId: session.id, childId: child.id, type: session.type },
  })
  redirect(`/practice/${session.id}`)
}

/** End the child's current active session so a new one can be started (Req 4.5). */
export async function endSessionAction(sessionId: string): Promise<{ error: string } | void> {
  const { parent } = await requireEntitledParent()
  await endSession(sessionId, parent.id)
  revalidatePath("/dashboard")
}

export interface GradeResult {
  ok: boolean
  expired?: boolean
  isCorrect?: boolean
  correctIndex?: number
  error?: string
}

/**
 * Grade a single answer. The browser sends only the slot position and the
 * chosen option index — never the correct answer. The server holds correctIndex,
 * computes correctness, and records it idempotently (first answer wins).
 */
export async function submitAnswerAction(
  sessionId: string,
  position: number,
  selectedIndex: number,
): Promise<GradeResult> {
  const { parent } = await requireEntitledParent()
  const session = await getSessionForParent(sessionId, parent.id)
  if (!session) return { ok: false, error: "Session not found." }

  // Server-authoritative expiry: reject answers after the deadline.
  if (session.status !== "active" || new Date(session.expiresAt).getTime() <= Date.now()) {
    await expireIfElapsed(sessionId)
    return { ok: false, expired: true }
  }

  if (position < 0 || position >= session.questionIds.length) {
    return { ok: false, error: "Invalid question." }
  }
  // Trust only our own mapping of position -> question id.
  const questionId = session.questionIds[position]!
  const question = await getQuestionById(questionId)
  if (!question) return { ok: false, error: "Question unavailable." }

  if (selectedIndex < 0 || selectedIndex >= question.options.length) {
    return { ok: false, error: "Invalid option." }
  }

  const isCorrect = selectedIndex === question.correctIndex
  // Idempotent: only the first answer for this slot is recorded.
  await recordAnswer({ sessionId, position, selectedIndex, isCorrect })

  // Safe to reveal the correct answer now that the child has committed an answer.
  return { ok: true, isCorrect, correctIndex: question.correctIndex }
}

/**
 * Finalise a session, roll answers into progress, generate the per-session AI
 * review synchronously within this request, and route to the result page.
 *
 * The score and per-topic summary are persisted to `review_reports` BEFORE any
 * AI call (Req 6.2), so the result page can always render even if the review
 * service degrades entirely to fallback. The Review Service never throws and is
 * bounded by an overall budget well inside `maxDuration` (Req 8).
 *
 * `redirect()` throws an internal control-flow signal, so it is only ever called
 * at the very end, outside any try/catch.
 */
export async function finishSessionAction(
  sessionId: string,
  reason: "completed" | "expired" = "completed",
): Promise<void> {
  const { parent } = await requireEntitledParent()
  const session = await getSessionForParent(sessionId, parent.id)
  if (!session) redirect("/dashboard")

  // Already finished (or never active): nothing to recompute — just show the result.
  if (session.status !== "active") {
    redirect(`/practice/${sessionId}/result`)
  }

  // 1–2. Finalise score/status and roll the answers into per-topic progress.
  const finished = await completeSession(sessionId, reason)
  if (finished) {
    await applySessionToProgress(sessionId, session.childId)
  }

  // 3. Gather the graded answers and their questions (server-side, with answers).
  const answers = await getSessionAnswers(sessionId)
  const questions = await getQuestionsByIds(session.questionIds)
  const questionById = new Map(questions.map((q) => [q.id, q]))
  const child = await getChildForParent(session.childId, parent.id)
  const yearGroup = child?.yearGroup ?? null

  // Deterministic per-topic summary + strongest/weakest (pure, Req 5.1–5.3).
  const perTopicSummary = computePerTopicSummary(answers)
  const { strongest, weakest } = strongestWeakest(perTopicSummary)

  // One review item per question the child got WRONG or did NOT attempt
  // (skipped / ran out of time). Build the PII-free AI context alongside, so
  // the two stay aligned by questionId. Unanswered slots have isCorrect === null
  // and answeredAt === null — they count as not-correct and must be explained.
  const reviewable = answers.filter((a) => a.isCorrect === false || a.answeredAt == null)
  const contexts: ReviewItemContext[] = []
  const items: ReviewItem[] = []
  for (const answer of reviewable) {
    const question = questionById.get(answer.questionId)
    if (!question) continue
    const correctAnswerText = question.options[question.correctIndex] ?? ""
    const attempted = answer.answeredAt != null
    const selectedAnswerText =
      attempted && answer.selectedIndex != null ? question.options[answer.selectedIndex] ?? null : null
    const context: ReviewItemContext = {
      questionId: question.id,
      topic: answer.topic,
      questionText: question.text,
      options: question.options,
      correctAnswerText,
      selectedAnswerText,
      attempted,
      imageDescription: question.imageDescription,
      yearGroup,
    }
    contexts.push(context)
    const { explanation, nextStep } = fallbackExplanation(context)
    items.push({ questionId: question.id, explanation, nextStep })
  }

  // 4. Persist the SKELETON review BEFORE any AI (Req 6.2). No wrong answers =>
  // already complete; otherwise pending until explanations are merged.
  const skeleton: ReviewDocument = {
    perTopicSummary,
    strongestTopic: strongest,
    weakestTopic: weakest,
    items,
    status: contexts.length === 0 ? "complete" : "pending",
  }
  await upsertReviewReport({ sessionId, document: skeleton, generatedBy: "fallback" })

  if (finished) {
    await audit({
      action: "session.completed",
      parentId: parent.id,
      detail: { sessionId, score: finished.score, total: finished.total, reason },
    })
  }

  // 5. Generate the AI explanations AFTER the response is sent (Next.js `after`),
  // so the parent is redirected to the result page immediately. The page renders
  // the skeleton (score + per-topic + deterministic fallback text) right away and
  // auto-refreshes while status === "pending"; once this background work finalises
  // the report to "complete", the AI explanations appear. On Vercel `after` keeps
  // the function alive past the response to do this (within maxDuration).
  if (contexts.length > 0) {
    after(async () => {
      try {
        const results = await generateReviewExplanations(contexts)
        const resultById = new Map(results.map((r) => [r.questionId, r]))
        const mergedItems: ReviewItem[] = items.map((item) => {
          const result = resultById.get(item.questionId)
          return result
            ? { questionId: item.questionId, explanation: result.explanation, nextStep: result.nextStep }
            : item
        })
        const generatedBy: ReviewGeneratedBy = results.some((r) => r.source === "nova") ? "nova" : "fallback"
        await upsertReviewReport({
          sessionId,
          document: {
            perTopicSummary,
            strongestTopic: strongest,
            weakestTopic: weakest,
            items: mergedItems,
            status: "complete",
          },
          generatedBy,
        })
      } catch (err) {
        // Never leave the report stuck "pending": finalise with the deterministic
        // fallback items already built above.
        console.error("[review] background generation failed:", err)
        await upsertReviewReport({
          sessionId,
          document: {
            perTopicSummary,
            strongestTopic: strongest,
            weakestTopic: weakest,
            items,
            status: "complete",
          },
          generatedBy: "fallback",
        }).catch(() => undefined)
      }
    })
  }

  revalidatePath("/dashboard")
  redirect(`/practice/${sessionId}/result`)
}
