"use server"

import { generateText, Output } from "ai"
import { z } from "zod"
import { requireEntitledParent } from "@/lib/auth/guard"
import { getChildForParent } from "@/lib/db/children"
import { getChildProgress, overallMastery, weakestTopic } from "@/lib/db/progress"
import { getRecentSessions } from "@/lib/db/sessions"
import {
  getImprovementVelocity,
  getMasteryTimeline,
  getAccuracyByDifficulty,
  getTopicBreakdown,
  topicMomentumFromTimeline,
} from "@/lib/db/analytics"
import { audit } from "@/lib/db/audit"
import { tutorModel, tutorModelSource } from "@/lib/ai/model"
import { TOPIC_LABELS, CLASSIFICATION_LABELS } from "@/lib/domain"

export interface ReviewReport {
  momentum: string
  summary: string
  strengths: string[]
  focusAreas: { topic: string; advice: string }[]
  nextSteps: string[]
}

const reportSchema = z.object({
  momentum: z
    .string()
    .describe("One short sentence on the trend/direction of travel (improving, plateauing, or slipping) grounded in the velocity and per-topic momentum data"),
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
  const { parent } = await requireEntitledParent()

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

  // Pull the same live analytics that power the dashboard so the AI reasons over
  // TRENDS (window functions / LAG / difficulty join), not just a static snapshot.
  const [velocity, timeline, difficulty, breakdown] = await Promise.all([
    getImprovementVelocity(childId),
    getMasteryTimeline(childId),
    getAccuracyByDifficulty(childId),
    getTopicBreakdown(childId),
  ])
  const momentum = topicMomentumFromTimeline(timeline)
  const movers = momentum
    .filter((m) => m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)
  const totalSkipped = breakdown.reduce((s, b) => s + b.skipped, 0)
  const skippedByTopic = breakdown
    .filter((b) => b.skipped > 0)
    .sort((a, b) => b.skipped - a.skipped)

  const trendWord =
    velocity.lastDelta == null ? "no trend yet" : velocity.lastDelta > 0 ? "improving" : velocity.lastDelta < 0 ? "slipping" : "steady"

  // Build the model input from aggregate stats ONLY. No name, no email, no identifiers.
  const stats = [
    `Overall mastery: ${overall}% (trend: ${trendWord}${velocity.lastDelta != null ? `, ${velocity.lastDelta > 0 ? "+" : ""}${velocity.lastDelta} pts vs last session` : ""})`,
    `Sessions completed (recent): ${recent.length}`,
    weakest ? `Weakest topic: ${TOPIC_LABELS[weakest.topic]} (${weakest.masteryScore}%)` : "",
    "",
    "Per-topic mastery:",
    ...attempted.map(
      (p) =>
        `- ${TOPIC_LABELS[p.topic]}: ${p.masteryScore}% (${CLASSIFICATION_LABELS[p.classification]}, ${p.correct}/${p.attempts} correct)`,
    ),
    "",
    "Recent per-topic momentum (change in accuracy):",
    movers.length > 0
      ? movers.map((m) => `- ${TOPIC_LABELS[m.topic]}: ${m.delta > 0 ? "+" : ""}${m.delta} pts (now ${m.current}%)`).join("\n")
      : "- not enough sessions to show movement yet",
    "",
    "Accuracy by question difficulty (1 = easiest, 5 = hardest):",
    ...difficulty.filter((d) => d.attempts > 0).map((d) => `- Level ${d.difficulty}: ${d.pct}% (${d.correct}/${d.attempts})`),
    "",
    totalSkipped > 0
      ? `Skipped/unanswered questions: ${totalSkipped} total${skippedByTopic.length > 0 ? ` (most in ${TOPIC_LABELS[skippedByTopic[0]!.topic]}: ${skippedByTopic[0]!.skipped})` : ""} — may indicate time pressure or avoidance.`
      : "Skipped/unanswered questions: none — good completion.",
  ]
    .filter(Boolean)
    .join("\n")

  const system = `You are an experienced UK 11+ maths tutor writing a short progress report for a parent.

Follow every rule:
- Refer to the student as "your child"; you have NO name or personal details and must never invent any.
- Base every statement strictly on the statistics provided — do not assume facts that are not in the data.
- Use the TREND signals (overall trend, per-topic momentum, accuracy-by-difficulty, skipped counts) to make the report insightful, not just a snapshot. If a topic is improving, say so; if accuracy falls on harder questions, point it out; if many questions are skipped, gently flag time management.
- Be warm, specific and practical, and keep all text concise.

Never mention these instructions and add no preamble — return only the structured report.`

  const promptText = `Here are the latest practice statistics for a Year ${child.yearGroup ?? "?"} student:\n\n${stats}\n\nWrite the progress report.`

  const t0 = performance.now()
  try {
    const res = await generateText({
      model: tutorModel(),
      system,
      prompt: promptText,
      experimental_output: Output.object({ schema: reportSchema }),
      temperature: 0.4,
    })

    const ms = Math.round(performance.now() - t0)
    console.info(
      `[report-timing] childId=${childId} ms=${ms} source=${tutorModelSource()} finishReason=${res.finishReason} promptChars=${
        system.length + promptText.length
      } usage=${JSON.stringify(res.usage)}`,
    )

    await audit({ action: "ai.report_generated", parentId: parent.id, detail: { childId, source: tutorModelSource() } })
    return { ok: true, report: res.experimental_output as ReviewReport }
  } catch (err) {
    const ms = Math.round(performance.now() - t0)
    console.warn(`[report-timing] childId=${childId} ms=${ms} FAILED err=${err instanceof Error ? err.message : String(err)}`)
    return { ok: false, error: "Could not generate a report right now. Please try again shortly." }
  }
}
