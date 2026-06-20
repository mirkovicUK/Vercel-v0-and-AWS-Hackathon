import { redirect, notFound } from "next/navigation"
import { requireEntitledParent } from "@/lib/auth/guard"
import { getChildForParent } from "@/lib/db/children"
import { getSessionForParent, getSessionAnswers, expireIfElapsed } from "@/lib/db/sessions"
import { getQuestionsByIds, toClientQuestion } from "@/lib/db/questions"
import { getChildProgress } from "@/lib/db/progress"
import { allocationFromTopics, formatAllocationExplanation } from "@/lib/practice/allocation-explanation"
import type { Topic } from "@/lib/domain"
import { PracticePlayer, type PlayerSlot } from "@/components/app/practice-player"

export const dynamic = "force-dynamic"

// The practice player calls finishSessionAction, which synchronously generates
// the per-session AI review (one bounded Bedrock call per wrong answer). Allow
// the function up to 60s so the review's overall time budget (45s) plus
// score/summary persistence always completes within the limit (Req 8.7, 8.8).
export const maxDuration = 60

export default async function PlayerPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const { parent } = await requireEntitledParent()

  const session = await getSessionForParent(sessionId, parent.id)
  if (!session) notFound()

  // If the session is already finished, send the parent to the results.
  if (session.status !== "active") redirect(`/practice/${sessionId}/result`)

  // Server-authoritative expiry check on load.
  const elapsed = new Date(session.expiresAt).getTime() <= Date.now()
  if (elapsed) {
    await expireIfElapsed(sessionId)
    redirect(`/practice/${sessionId}/result`)
  }

  const child = await getChildForParent(session.childId, parent.id)
  if (!child) notFound()

  const [questions, answers] = await Promise.all([
    getQuestionsByIds(session.questionIds),
    getSessionAnswers(sessionId),
  ])

  const byId = new Map(questions.map((q) => [q.id, q]))
  const answerByPos = new Map(answers.map((a) => [a.position, a]))

  // Build ordered player slots. ANSWER FIREWALL: unanswered slots carry the
  // client-safe question only (no correctIndex). Already-answered slots may
  // safely include correctIndex because the child has already committed.
  const slots: PlayerSlot[] = session.questionIds.map((qid, position) => {
    const q = byId.get(qid)!
    const ans = answerByPos.get(position)
    if (ans && ans.answeredAt) {
      return {
        position,
        question: toClientQuestion(q),
        answered: {
          selectedIndex: ans.selectedIndex!,
          isCorrect: ans.isCorrect!,
          correctIndex: q.correctIndex,
        },
      }
    }
    return { position, question: toClientQuestion(q), answered: null }
  })

  const remainingSeconds = Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000))

  // Adaptive-only explainability (Req 9.3): show the per-topic allocation
  // breakdown and (Req 9.4) a calibrating note when the child is cold-start.
  // Both derivations are NON-BLOCKING (Req 9.6): any failure or empty result
  // simply omits the block without breaking the player page. Gated strictly on
  // the adaptive type, so warmup/topic/mock never render it.
  let adaptiveMix: string | null = null
  let calibrating = false
  if (session.type === "adaptive") {
    try {
      // Build the ordered topic list from the session's questions (in question
      // order), then reconstruct + format the allocation. No correctIndex is
      // touched here — only each question's topic.
      const orderedTopics = session.questionIds
        .map((qid) => byId.get(qid)?.topic)
        .filter((t): t is Topic => Boolean(t))
      const summary = formatAllocationExplanation(allocationFromTopics(orderedTopics))
      adaptiveMix = summary.length > 0 ? summary : null
    } catch {
      adaptiveMix = null
    }
    try {
      // Read progress DURING the active session. Progress is only rolled in at
      // finishSessionAction, so this read still reflects the PRE-session state.
      // Every topic showing 0 attempts ⇒ cold start ⇒ render the calibrating note.
      const progress = await getChildProgress(session.childId)
      calibrating = progress.length > 0 && progress.every((p) => p.attempts === 0)
    } catch {
      calibrating = false
    }
  }

  return (
    <PracticePlayer
      sessionId={session.id}
      childName={child.displayName}
      sessionType={session.type}
      topic={session.topic}
      slots={slots}
      remainingSeconds={remainingSeconds}
      helpUsed={session.helpUsed}
      adaptiveMix={adaptiveMix}
      calibrating={calibrating}
    />
  )
}
