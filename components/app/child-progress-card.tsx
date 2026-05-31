import Link from "next/link"
import type { Child, TopicProgress } from "@/lib/domain"
import { TOPIC_LABELS } from "@/lib/domain"
import { overallMastery, weakestTopic } from "@/lib/db/progress"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ChildAvatar } from "@/components/app/child-avatar"
import { TopicMasteryList } from "@/components/app/topic-mastery-list"
import { AlertCircle, Play, Sparkles } from "lucide-react"

export function ChildProgressCard({
  child,
  progress,
}: {
  child: Child
  progress: TopicProgress[]
}) {
  const overall = overallMastery(progress)
  const weakest = weakestTopic(progress)
  const hasActivity = progress.some((p) => p.attempts > 0)

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-5 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ChildAvatar name={child.displayName} color={child.avatarColor} className="size-12 text-base" />
            <div>
              <p className="font-heading text-base font-semibold text-foreground">{child.displayName}</p>
              <p className="text-xs text-muted-foreground">
                {child.yearGroup ? `Year ${child.yearGroup}` : "11+ preparation"}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-heading text-2xl font-bold tabular-nums text-foreground">
              {hasActivity ? `${overall}%` : "—"}
            </p>
            <p className="text-xs text-muted-foreground">overall mastery</p>
          </div>
        </div>

        {hasActivity && weakest ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">Focus next: {TOPIC_LABELS[weakest.topic]}</p>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              This is {child.displayName}&apos;s weakest topic right now at {Math.round(weakest.masteryScore)}%. A short
              session here will lift their score the fastest.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/10 p-4">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-foreground" />
            <p className="text-sm leading-relaxed text-foreground">
              No sessions yet. Start a warm-up and {child.displayName}&apos;s progress will appear here within minutes.
            </p>
          </div>
        )}

        <TopicMasteryList progress={progress} />

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild className="flex-1">
            <Link href={`/practice/new?child=${child.id}`}>
              <Play className="size-4" />
              Start a session
            </Link>
          </Button>
          <Button asChild variant="outline" className="flex-1">
            <Link href={`/children/${child.id}`}>View detail</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
