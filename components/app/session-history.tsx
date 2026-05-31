import type { PracticeSession } from "@/lib/domain"
import { SESSION_TYPE_CONFIG, TOPIC_LABELS } from "@/lib/domain"
import { CheckCircle2, Clock, FileText } from "lucide-react"
import { cn } from "@/lib/utils"

function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export function SessionHistory({ sessions }: { sessions: PracticeSession[] }) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No completed sessions yet. Once a session is finished it will appear here with the score.
      </div>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
      {sessions.map((s) => {
        const pct = s.total > 0 && s.score != null ? Math.round((s.score / s.total) * 100) : 0
        const expired = s.status === "expired"
        return (
          <li key={s.id} className="flex items-center justify-between gap-4 p-4">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full",
                  expired ? "bg-muted text-muted-foreground" : "bg-success/15 text-success",
                )}
              >
                {expired ? <Clock className="size-4" /> : <CheckCircle2 className="size-4" />}
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {SESSION_TYPE_CONFIG[s.type].label}
                  {s.topic ? <span className="text-muted-foreground"> · {TOPIC_LABELS[s.topic]}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(s.completedAt)}
                  {expired ? " · timed out" : ""}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {s.score ?? 0}/{s.total}
              </p>
              <p className="text-xs text-muted-foreground">{pct}%</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
