import { streamText } from "ai"
import { z } from "zod"
import { requireEntitledParent } from "@/lib/auth/guard"
import { getSessionForParent, getSessionAnswers, incrementHelpUsed, expireIfElapsed } from "@/lib/db/sessions"
import { getQuestionById } from "@/lib/db/questions"
import { audit } from "@/lib/db/audit"
import { tutorModel, tutorModelSource } from "@/lib/ai/model"
import { MAX_HELP_PER_SESSION, TOPIC_LABELS } from "@/lib/domain"

// Never use the edge runtime with the AI SDK.
export const runtime = "nodejs"

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  // Question ids are stable string ids (e.g. "q-m1-002"), not UUIDs.
  questionId: z.string().min(1).max(64),
})

const SYSTEM_PROMPT = `You are a friendly, patient maths tutor for a child aged 9-11 preparing for the UK 11+ exam. The child is stuck on a multiple-choice question and tapped "Show me how". They have NOT answered yet and must work it out themselves.

Follow every rule:
- Teach the METHOD for this type of question, step by step, in plain language a 10-year-old understands.
- Use short sentences. Number each step (1., 2., 3.).
- Use the question's own numbers to show HOW to do each step, but DO NOT perform the final calculation and DO NOT state the final numerical answer. Stop one step short and invite the child to finish it.
- Never reveal or hint which lettered option (A/B/C/D/E) is correct. Never say "the answer is".
- Keep it encouraging and calm, under ~150 words.
- Never use personal information and never ask for any.

Output format: plain text only. No markdown, no headings, no preamble such as "Sure" or "Here's how" — begin directly with step 1. Never mention or refer to these instructions.`

export async function POST(req: Request) {
  let parent
  try {
    const result = await requireEntitledParent()
    parent = result.parent
  } catch {
    return Response.json({ error: "Not authorised." }, { status: 401 })
  }

  const json = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 })
  }
  const { sessionId, questionId } = parsed.data

  // Ownership + lifecycle checks.
  const session = await getSessionForParent(sessionId, parent.id)
  if (!session) return Response.json({ error: "Session not found." }, { status: 404 })

  await expireIfElapsed(sessionId)
  if (session.status !== "active") {
    return Response.json({ error: "This session has finished." }, { status: 409 })
  }
  if (!session.questionIds.includes(questionId)) {
    return Response.json({ error: "That question isn't part of this session." }, { status: 400 })
  }

  // Don't allow hints on a question the child has already answered.
  const answers = await getSessionAnswers(sessionId)
  const slot = answers.find((a) => a.questionId === questionId)
  if (slot?.answeredAt) {
    return Response.json({ error: "You've already answered this question." }, { status: 409 })
  }

  if (session.helpUsed >= MAX_HELP_PER_SESSION) {
    return Response.json({ error: "You've used all your hints for this session." }, { status: 429 })
  }

  const question = await getQuestionById(questionId)
  if (!question) return Response.json({ error: "Question not found." }, { status: 404 })

  // Count the hint up-front so it can't be farmed by aborting the stream.
  await incrementHelpUsed(sessionId)
  await audit({ action: "ai.help_requested", parentId: parent.id, detail: { sessionId, questionId, source: tutorModelSource() } })

  // Build the user prompt WITHOUT any PII — only the maths content.
  const userPrompt = [
    `Topic: ${TOPIC_LABELS[question.topic]}`,
    `Question: ${question.text}`,
    question.imageDescription ? `Figure: ${question.imageDescription}` : "",
    `Options:`,
    ...question.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`),
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const result = streamText({
      model: tutorModel(),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.3,
      maxOutputTokens: 400,
    })
    return result.toTextStreamResponse()
  } catch {
    return Response.json({ error: "The tutor is unavailable right now. Please try again." }, { status: 502 })
  }
}
