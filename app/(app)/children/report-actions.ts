"use server"

import { generateText, Output } from "ai"
import { z } from "zod"
import { requireEntitledParent } from "@/lib/auth/guard"
import { getChildForParent } from "@/lib/db/children"
import { getChildProgress, overallMastery, weakestTopic } from "@/lib/db/progress"
import { getRecentSessions } from "@/lib/db/sessions"
import { audit } from "@/lib/db/audit"
import { novaModel, novaSource } from "@/lib/ai/model"
import { TOPIC_LABELS, CLASSIFICATION_LABELS } from "@/lib/domain"

export interface ReviewReport {
  summary: string
  strengths: string[]
  focusAreas: { topic: string; advice: string }[]
  nextSteps: string[]
}

const reportSchema = z.object({
  summary: z.string().describe("2-3 sentence parent-facing overview of how the learner is doing"),
  strengths: z.array(z.string()).describe("2-4 short, specific strengths"),
  focusAreas: z
    .array(z.object({ topic: z.string(), advice: z.string() }))
    .describe("1-3 topics to improve, each with one concrete, encouraging tip"),
  nextSteps: z.array(z.string()).describe("2-3 concrete recommended actions for the next week"),
})

export async function generateReviewReport(
  childId: string,
): Promise<{ ok: true; report: ReviewReport } | { ok: false; error: string }> {
  const parent = await requireEntitledParent()

  const child = await getChildForParent(childId, parent.id)
  if (!child) return { ok: false, error: "Child not found." }

  const progress = await getChildProgress(childId)
  const attempted = progress.filter((p) => p.attempts > 0)
  if (attempted.length === 0) {
    return { ok: false, error: "Not enough practice yet — complete a session first to generate a report." }
  }

  const recent = await getRecentSessions(childId, 5)
  const overall = overallMastery(progress)
  const weakest = weakestTopic(progress)

  // Build the model input from aggregate stats ONLY. No name, no email, no identifiers.
  const stats = [
    `Overall mastery: ${overall}%`,
    weakest ? `Weakest topic: ${TOPIC_LABELS[weakest.topic]} (${weakest.masteryScore}%)` : "",
    `Recent sessions completed: ${recent.length}`,
    "",
    "Per-topic mastery:",
    ...attempted.map(
      (p) =>
        `- ${TOPIC_LABELS[p.topic]}: ${p.masteryScore}% (${CLASSIFICATION_LABELS[p.classification]}, ${p.correct}/${p.attempts} correct)`,
    ),
  ]
    .filter(Boolean)
    .join("\n")

  const system = `You are an experienced UK 11+ maths tutor writing a short progress report for a parent.
Refer to the student as "your child" — you have NO name or personal details, and must never invent any.
Be warm, specific and practical. Base everything strictly on the statistics provided. Keep all text concise.`

  try {
    const { experimental_output } = await generateText({
      model: novaModel(),
      system,
      prompt: `Here are the latest practice statistics for a Year ${child.yearGroup ?? "?"} student:\n\n${stats}\n\nWrite the progress report.`,
      experimental_output: Output.object({ schema: reportSchema }),
      temperature: 0.4,
    })

    await audit({ action: "ai.report_generated", parentId: parent.id, detail: { childId, source: novaSource() } })
    return { ok: true, report: experimental_output as ReviewReport }
  } catch {
    return { ok: false, error: "Could not generate a report right now. Please try again shortly." }
  }
}
