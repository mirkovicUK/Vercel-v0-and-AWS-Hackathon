import { TOPIC_LABELS, CLASSIFICATION_LABELS, type MasteryClassification, type TopicProgress } from "@/lib/domain"
import { cn } from "@/lib/utils"

const toneStyles: Record<MasteryClassification, { bar: string; badge: string }> = {
  strong: { bar: "bg-success", badge: "bg-success/15 text-success" },
  developing: { bar: "bg-primary", badge: "bg-primary/10 text-primary" },
  needs_focus: { bar: "bg-destructive", badge: "bg-destructive/10 text-destructive" },
}

export function TopicMasteryList({ progress }: { progress: TopicProgress[] }) {
  return (
    <ul className="flex flex-col gap-4" aria-label="Topic mastery breakdown">
      {progress.map((p) => {
        const tone = toneStyles[p.classification]
        const attempted = p.attempts > 0
        return (
          <li key={p.topic} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{TOPIC_LABELS[p.topic]}</span>
              <div className="flex items-center gap-2">
                {attempted ? (
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", tone.badge)}>
                    {CLASSIFICATION_LABELS[p.classification]}
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Not started
                  </span>
                )}
                <span className="w-10 text-right text-sm font-semibold tabular-nums text-foreground">
                  {attempted ? `${Math.round(p.masteryScore)}%` : "—"}
                </span>
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all", attempted ? tone.bar : "bg-transparent")}
                style={{ width: `${attempted ? p.masteryScore : 0}%` }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
