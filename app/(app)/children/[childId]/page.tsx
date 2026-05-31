import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { requireOnboardedParent } from "@/lib/auth/guard"
import { getChildForParent } from "@/lib/db/children"
import { getChildProgress, overallMastery, weakestTopic } from "@/lib/db/progress"
import { getRecentSessions } from "@/lib/db/sessions"
import { TOPIC_LABELS } from "@/lib/domain"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ChildAvatar } from "@/components/app/child-avatar"
import { TopicMasteryList } from "@/components/app/topic-mastery-list"
import { SessionHistory } from "@/components/app/session-history"
import { DeleteChildButton } from "@/components/app/delete-child-button"
import { ReviewReportDialog } from "@/components/app/review-report-dialog"
import { ArrowLeft, Play, AlertCircle } from "lucide-react"

export const metadata: Metadata = {
  title: "Child progress",
}

export default async function ChildDetailPage({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params
  const parent = await requireOnboardedParent()
  const child = await getChildForParent(childId, parent.id)
  if (!child) notFound()

  const [progress, sessions] = await Promise.all([getChildProgress(childId), getRecentSessions(childId, 10)])
  const overall = overallMastery(progress)
  const weakest = weakestTopic(progress)
  const hasActivity = progress.some((p) => p.attempts > 0)

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to dashboard
      </Link>

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
          </CardHeader>
          <CardContent>
            <SessionHistory sessions={sessions} />
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
