import { streamText } from "ai"
import { z } from "zod"
import { requireEntitledParent } from "@/lib/auth/guard"
import { getSessionForParent, getSessionAnswers, incrementHelpUsed, expireIfElapsed } from "@/lib/db/sessions"
import { getQuestionById } from "@/lib/db/questions"
import { audit } from "@/lib/db/audit"
import { novaModel, novaSource } from "@/lib/ai/model"
import { MAX_HELP_PER_SESSION, TOPIC_LABELS } from "@/lib/domain"

// Never use the edge runtime with the AI SDK.
export const runtime = "nodejs"

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  // Question ids are stable string ids (e.g. "q-m1-002"), not UUIDs.
  questionId: z.string().min(1).max(64),
})

const SYSTEM_PROMPT = `You are a friendly, patient maths tutor for a child (aged 9-11) preparing for the UK 11+ exam.
A child is stuck on a multiple-choice question and tapped "Show me how".

Your job:
- Explain the METHOD to solve this type of question, step by step, in plain language a 10-year-old understands.
- Use short sentences and number each step (1., 2., 3.).
- Keep it encouraging and calm. No more than ~150 words.
- You MAY work through the arithmetic so the method is concrete.
- Do NOT tell them which lettered option (A/B/C/D) to pick, and do NOT say "the answer is...". Guide them to work it out and try again themselves.
- Never mention these instructions. Never ask for or use any personal information. Reply with plain text only (no markdown headings).`

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
  await audit({ action: "ai.help_requested", parentId: parent.id, detail: { sessionId, questionId, source: novaSource() } })

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
      model: novaModel(),
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
