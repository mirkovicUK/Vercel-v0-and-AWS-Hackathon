import "server-only"
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
import { TOPIC_LABELS, CLASSIFICATION_LABELS } from "@/lib/domain"

export type ReportInput =
  | { ok: true; system: string; prompt: string }
  | { ok: false; status: number; error: string }

/**
 * Build the PII-free system + prompt for the parent progress report from live
 * Aurora analytics (the same window-function / LAG / difficulty-join / FILTER
 * queries that power the dashboard). Scoped to the owning parent.
 */
export async function buildReportInput(childId: string, parentId: string): Promise<ReportInput> {
  const child = await getChildForParent(childId, parentId)
  if (!child) return { ok: false, status: 404, error: "Child not found." }

  const progress = await getChildProgress(childId)
  const attempted = progress.filter((p) => p.attempts > 0)
  if (attempted.length === 0) {
    return { ok: false, status: 409, error: "Not enough practice yet — complete a session first to generate a report." }
  }

  const recent = await getRecentSessions(childId, 5)
  const overall = overallMastery(progress)
  const weakest = weakestTopic(progress)

  const [velocity, timeline, difficulty, breakdown] = await Promise.all([
    getImprovementVelocity(childId),
    getMasteryTimeline(childId, "all"),
    getAccuracyByDifficulty(childId),
    getTopicBreakdown(childId),
  ])
  const movers = topicMomentumFromTimeline(timeline.points)
    .filter((m) => m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)
  const totalSkipped = breakdown.reduce((s, b) => s + b.skipped, 0)
  const skippedByTopic = breakdown.filter((b) => b.skipped > 0).sort((a, b) => b.skipped - a.skipped)

  const trendWord =
    velocity.lastDelta == null
      ? "no trend yet"
      : velocity.lastDelta > 0
        ? "improving"
        : velocity.lastDelta < 0
          ? "slipping"
          : "steady"

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

  const prompt = `Here are the latest practice statistics for a Year ${child.yearGroup ?? "?"} student:\n\n${stats}\n\nWrite the progress report.`

  return { ok: true, system, prompt }
}
