import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { requireEntitledParent } from "@/lib/auth/guard"
import { getChildForParent } from "@/lib/db/children"
import { getSessionForParent, getSessionAnswers } from "@/lib/db/sessions"
import { getQuestionsByIds } from "@/lib/db/questions"
import { getReviewReport } from "@/lib/db/reviews"
import { SESSION_TYPE_CONFIG, TOPIC_LABELS, type Topic } from "@/lib/domain"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Check, X, Minus, Trophy, ChevronRight, Lightbulb } from "lucide-react"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

export default async function ResultPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const { parent } = await requireEntitledParent()

  const session = await getSessionForParent(sessionId, parent.id)
  if (!session) notFound()
  if (session.status === "active") redirect(`/practice/${sessionId}`)

  const child = await getChildForParent(session.childId, parent.id)
  if (!child) notFound()

  const [questions, answers, review] = await Promise.all([
    getQuestionsByIds(session.questionIds),
    getSessionAnswers(sessionId),
    getReviewReport(sessionId),
  ])
  const byId = new Map(questions.map((q) => [q.id, q]))
  const answerByPos = new Map(answers.map((a) => [a.position, a]))

  // Map of questionId -> stored explanation/next step. Present only for wrong
  // answers that have a generated (or fallback) review item.
  const reviewByQuestionId = new Map(
    (review?.document.items ?? []).map((item) => [
      item.questionId,
      { explanation: item.explanation, nextStep: item.nextStep },
    ]),
  )
  const reviewPending = review?.document.status === "pending"

  const score = session.score ?? 0
  const total = session.total
  const pct = total > 0 ? Math.round((score / total) * 100) : 0

  // Per-topic breakdown for this session.
  const topicStats = new Map<Topic, { correct: number; total: number }>()
  for (const a of answers) {
    const s = topicStats.get(a.topic) ?? { correct: 0, total: 0 }
    s.total += 1
    if (a.isCorrect) s.correct += 1
    topicStats.set(a.topic, s)
  }

  const config = SESSION_TYPE_CONFIG[session.type]
  const headline =
    pct >= 80 ? "Excellent work!" : pct >= 60 ? "Good effort!" : pct >= 40 ? "Keep practising!" : "Room to grow"

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      {/* Score summary */}
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-accent/15">
            <Trophy className="size-7 text-accent-foreground" />
          </span>
          <h1 className="font-heading text-2xl font-bold text-foreground">{headline}</h1>
          <p className="text-sm text-muted-foreground">
            {child.displayName} · {config.label}
            {session.status === "expired" ? " · time ran out" : ""}
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-heading text-5xl font-bold tabular-nums text-foreground">{score}</span>
            <span className="text-xl text-muted-foreground">/ {total}</span>
          </div>
          <Badge variant="secondary" className="tabular-nums">
            {pct}% correct
          </Badge>
        </CardContent>
      </Card>

      {/* Per-topic breakdown */}
      {topicStats.size > 0 ? (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-foreground">How each topic went</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {[...topicStats.entries()].map(([topic, s]) => (
              <div
                key={topic}
                className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
              >
                <span className="text-sm font-medium text-foreground">{TOPIC_LABELS[topic]}</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {s.correct}/{s.total}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Question-by-question review */}
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Review answers</h2>
        {reviewPending ? (
          <p className="mb-3 rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">
            Explanations are still finishing — refresh in a moment.
          </p>
        ) : null}
        <div className="flex flex-col gap-3">
          {session.questionIds.map((qid, position) => {
            const q = byId.get(qid)
            const a = answerByPos.get(position)
            if (!q) return null
            const answered = a && a.selectedIndex !== null
            const correct = a?.isCorrect ?? false
            const reviewItem = reviewByQuestionId.get(qid)
            return (
              <Card key={qid}>
                <CardContent className="flex flex-col gap-3 p-5">
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                        !answered
                          ? "bg-muted text-muted-foreground"
                          : correct
                            ? "bg-success text-success-foreground"
                            : "bg-destructive text-destructive-foreground",
                      )}
                    >
                      {!answered ? <Minus className="size-3.5" /> : correct ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                    </span>
                    <div className="flex flex-1 flex-col gap-0.5">
                      <p className="text-sm font-medium leading-snug text-foreground">{q.text}</p>
                      {!answered ? (
                        <span className="text-xs font-medium text-muted-foreground">
                          Not answered — this question was skipped
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="ml-9 grid gap-1.5">
                    {q.options.map((opt, i) => {
                      const isCorrect = i === q.correctIndex
                      const isChosen = a?.selectedIndex === i
                      return (
                        <div
                          key={i}
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                            isCorrect && "bg-success/10 font-medium text-foreground",
                            isChosen && !isCorrect && "bg-destructive/10 text-foreground",
                            !isCorrect && !isChosen && "text-muted-foreground",
                          )}
                        >
                          <span className="text-xs font-semibold text-muted-foreground">
                            {String.fromCharCode(65 + i)}
                          </span>
                          {opt}
                          {isCorrect ? <Check className="ml-auto size-4 text-success" /> : null}
                          {isChosen && !isCorrect ? <X className="ml-auto size-4 text-destructive" /> : null}
                        </div>
                      )
                    })}
                  </div>
                  {reviewItem ? (
                    <div className="ml-9 rounded-lg border border-accent/20 bg-accent/10 p-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-foreground">
                        <Lightbulb className="size-3.5" />
                        Explanation
                      </div>
                      <p className="mt-1.5 text-sm leading-snug text-foreground">{reviewItem.explanation}</p>
                      <p className="mt-2 text-sm leading-snug text-muted-foreground">
                        <span className="font-medium text-foreground">Next step:</span> {reviewItem.nextStep}
                      </p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button asChild>
          <Link href={`/practice/new?child=${child.id}`}>
            Practise again
            <ChevronRight className="size-4" />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </main>
  )
}
