import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { requireOnboardedParent } from "@/lib/auth/guard"
import { getChildForParent } from "@/lib/db/children"
import { getChildProgress, overallMastery, weakestTopic } from "@/lib/db/progress"
import { getRecentSessions } from "@/lib/db/sessions"
import {
  getMasteryTimeline,
  getAccuracyByDifficulty,
  getTopicBreakdown,
  getImprovementVelocity,
} from "@/lib/db/analytics"
import { TOPIC_LABELS } from "@/lib/domain"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ChildAvatar } from "@/components/app/child-avatar"
import { TopicMasteryList } from "@/components/app/topic-mastery-list"
import { SessionHistory } from "@/components/app/session-history"
import { DeleteChildButton } from "@/components/app/delete-child-button"
import { ReviewReportDialog } from "@/components/app/review-report-dialog"
import { ImprovementVelocityCard } from "@/components/app/improvement-velocity-card"
import { MasteryTimelineChart } from "@/components/app/charts/mastery-timeline-chart"
import { AccuracyByDifficultyChart } from "@/components/app/charts/accuracy-by-difficulty-chart"
import { TopicBreakdownChart } from "@/components/app/charts/topic-breakdown-chart"
import { ArrowLeft, Play, AlertCircle, ListChecks, Trophy } from "lucide-react"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Child progress",
}

export default async function ChildDetailPage({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params
  const parent = await requireOnboardedParent()
  const child = await getChildForParent(childId, parent.id)
  if (!child) notFound()

  const [progress, sessions, timeline, difficulty, breakdown, velocity] = await Promise.all([
    getChildProgress(childId),
    getRecentSessions(childId, 5),
    getMasteryTimeline(childId),
    getAccuracyByDifficulty(childId),
    getTopicBreakdown(childId),
    getImprovementVelocity(childId),
  ])

  const overall = overallMastery(progress)
  const weakest = weakestTopic(progress)
  const hasActivity = progress.some((p) => p.attempts > 0)

  // Cheap header stats derived from already-fetched data (no extra query).
  const attemptedProgress = progress.filter((p) => p.attempts > 0)
  const totalAnswered = attemptedProgress.reduce((s, p) => s + p.attempts, 0)
  const totalCorrect = attemptedProgress.reduce((s, p) => s + p.correct, 0)
  const strongest =
    attemptedProgress.length > 0
      ? attemptedProgress.reduce((best, p) => (p.masteryScore > best.masteryScore ? p : best))
      : null

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to dashboard
      </Link>

      {/* Header — unchanged controls */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <ChildAvatar name={child.displayName} color={child.avatarColor} className="size-14 text-lg" />
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">{child.displayName}</h1>
            <p className="text-sm text-muted-foreground">
              {child.yearGroup ? `Year ${child.yearGroup} · ` : ""}
              {hasActivity ? `${overall}% overall mastery` : "No sessions yet"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DeleteChildButton childId={child.id} childName={child.displayName} />
          {hasActivity ? <ReviewReportDialog childId={child.id} childName={child.displayName} /> : null}
          <Button asChild>
            <Link href={`/practice/new?child=${child.id}`}>
              <Play className="size-4" />
              Start a session
            </Link>
          </Button>
        </div>
      </div>

      {hasActivity && weakest ? (
        <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">Focus next: {TOPIC_LABELS[weakest.topic]}</p>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            At {Math.round(weakest.masteryScore)}%, this is {child.displayName}&apos;s lowest topic. Practising it will
            raise their overall mastery the fastest.
          </p>
        </div>
      ) : null}

      {/* Stat tiles */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <ImprovementVelocityCard velocity={velocity} />
        <div className="flex h-full flex-col justify-between rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Questions answered</p>
            <ListChecks className="size-4 text-muted-foreground" />
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className="font-heading text-4xl font-bold tabular-nums text-foreground">{totalAnswered}</span>
            <span className="mb-1 text-xs text-muted-foreground">{totalCorrect} correct</span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">across all completed sessions</p>
        </div>
        <div className="flex h-full flex-col justify-between rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Strongest topic</p>
            <Trophy className="size-4 text-muted-foreground" />
          </div>
          <div className="mt-1">
            <span className="font-heading text-2xl font-bold text-foreground">
              {strongest ? TOPIC_LABELS[strongest.topic] : "—"}
            </span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {strongest ? `${Math.round(strongest.masteryScore)}% mastery` : "Complete a session to see"}
          </p>
        </div>
      </div>

      {/* Mastery over time — window-function timeline */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Mastery over time</CardTitle>
          <p className="text-sm text-muted-foreground">Cumulative accuracy per topic after each session.</p>
        </CardHeader>
        <CardContent>
          <MasteryTimelineChart points={timeline} />
        </CardContent>
      </Card>

      {/* Difficulty + topic breakdown */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accuracy by difficulty</CardTitle>
            <p className="text-sm text-muted-foreground">How {child.displayName} does as questions get harder.</p>
          </CardHeader>
          <CardContent>
            <AccuracyByDifficultyChart data={difficulty} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Answers by topic</CardTitle>
            <p className="text-sm text-muted-foreground">Correct, wrong, and skipped across all sessions.</p>
          </CardHeader>
          <CardContent>
            <TopicBreakdownChart data={breakdown} />
          </CardContent>
        </Card>
      </div>

      {/* Mastery list + recent sessions */}
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Mastery by topic</CardTitle>
          </CardHeader>
          <CardContent>
            <TopicMasteryList progress={progress} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent sessions</CardTitle>
            <p className="text-sm text-muted-foreground">Tap a session for the full breakdown.</p>
          </CardHeader>
          <CardContent>
            <SessionHistory sessions={sessions} />
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
