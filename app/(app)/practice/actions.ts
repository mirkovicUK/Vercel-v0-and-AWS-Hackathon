"use server"

import { z } from "zod"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { requireEntitledParent } from "@/lib/auth/guard"
import { getChildForParent } from "@/lib/db/children"
import {
  createSession,
  getSessionForParent,
  getSessionAnswers,
  recordAnswer,
  completeSession,
  expireIfElapsed,
} from "@/lib/db/sessions"
import { getQuestionById, getQuestionsByIds, pickQuestionIds } from "@/lib/db/questions"
import { applySessionToProgress } from "@/lib/db/progress"
import { audit } from "@/lib/db/audit"
import {
  SESSION_TYPE_CONFIG,
  TOPICS,
  type SessionType,
  type Topic,
} from "@/lib/domain"

const startSchema = z.object({
  childId: z.string().uuid("Invalid child."),
  type: z.enum(["warmup", "topic", "mock"]),
  topic: z.enum(TOPICS).optional(),
})

/** Create a new practice session and route into the player. */
export async function startSessionAction(formData: FormData): Promise<{ error: string } | void> {
  const { parent } = await requireEntitledParent()
  const parsed = startSchema.safeParse({
    childId: formData.get("childId"),
    type: formData.get("type"),
    topic: formData.get("topic") || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request." }

  const child = await getChildForParent(parsed.data.childId, parent.id)
  if (!child) return { error: "We couldn't find that child profile." }

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

  const session = await createSession({
    childId: child.id,
    parentId: parent.id,
    type: parsed.data.type as SessionType,
    topic,
    questionIds: orderedIds,
    questionTopics,
    timeLimitSeconds: config.timeLimitSeconds,
  })
  await audit({
    action: "session.started",
    parentId: parent.id,
    detail: { sessionId: session.id, childId: child.id, type: session.type },
  })
  redirect(`/practice/${session.id}`)
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

/** Finalise a session, roll answers into progress, and route to the result page. */
export async function finishSessionAction(
  sessionId: string,
  reason: "completed" | "expired" = "completed",
): Promise<void> {
  const { parent } = await requireEntitledParent()
  const session = await getSessionForParent(sessionId, parent.id)
  if (!session) redirect("/dashboard")

  if (session.status === "active") {
    const finished = await completeSession(sessionId, reason)
    if (finished) {
      await applySessionToProgress(sessionId, session.childId)
      await audit({
        action: "session.completed",
        parentId: parent.id,
        detail: { sessionId, score: finished.score, total: finished.total, reason },
      })
    }
  }
  revalidatePath("/dashboard")
  redirect(`/practice/${sessionId}/result`)
}
