"use client"

import { useState, type ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { SESSION_TYPE_CONFIG, TOPIC_LABELS, type PracticeSession } from "@/lib/domain"
import { getSessionDetailAction } from "@/app/(app)/children/session-actions"
import type { SessionDetail } from "@/lib/db/session-detail"
import { cn } from "@/lib/utils"
import { Check, X, Minus, ChevronDown, Lightbulb, AlertCircle, Target } from "lucide-react"

function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export function SessionDetailDialog({ session, children }: { session: PracticeSession; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(false)

  async function onOpenChange(next: boolean) {
    setOpen(next)
    if (next && !loaded && !loading) {
      setLoading(true)
      setError(false)
      try {
        const result = await getSessionDetailAction(session.id)
        if (!result) setError(true)
        else setDetail(result)
        setLoaded(true)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
  }

  const pct = session.total > 0 && session.score != null ? Math.round((session.score / session.total) * 100) : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {SESSION_TYPE_CONFIG[session.type].label}
            {session.topic ? <span className="text-muted-foreground">· {TOPIC_LABELS[session.topic]}</span> : null}
            <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">
              {session.score ?? 0}/{session.total} · {pct}%
            </span>
          </DialogTitle>
          <DialogDescription>
            {formatDate(session.completedAt)}
            {session.status === "expired" ? " · timed out" : ""}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading this session…
          </div>
        ) : error || !detail ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <AlertCircle className="size-4" />
            Couldn&apos;t load this session.
          </div>
        ) : (
          <>
            {/* Struggle summary — computed in SQL (FILTER aggregate), not by AI. */}
            {detail.struggle.length > 0 ? (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                {detail.weakestTopic ? (
                  <div className="flex items-center gap-2">
                    <Target className="size-4 text-primary" />
                    <p className="text-sm font-semibold text-foreground">
                      Struggled most on {TOPIC_LABELS[detail.weakestTopic]}
                    </p>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {detail.struggle.map((s) => (
                    <span
                      key={s.topic}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs"
                    >
                      <span className="font-medium text-foreground">{TOPIC_LABELS[s.topic]}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {s.correct}/{s.attempted}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                          s.pct >= 80
                            ? "bg-success/15 text-success"
                            : s.pct >= 50
                              ? "bg-primary/10 text-primary"
                              : "bg-destructive/10 text-destructive",
                        )}
                      >
                        {s.pct}%
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {detail.reviewPending ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                AI explanations are still finishing for this session.
              </p>
            ) : null}

            {/* Per-question review — all folded, click to expand. */}
            <div className="flex flex-col gap-2.5">
              {detail.answers.map((a) => {
                const letter = (i: number) => String.fromCharCode(65 + i)
                return (
                  <div key={a.position} className="overflow-hidden rounded-xl border border-border">
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                        <span
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-full",
                            !a.answered
                              ? "bg-muted text-muted-foreground"
                              : a.isCorrect
                                ? "bg-success text-success-foreground"
                                : "bg-destructive text-destructive-foreground",
                          )}
                        >
                          {!a.answered ? <Minus className="size-3.5" /> : a.isCorrect ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                        </span>
                        <span className="flex-1 truncate text-sm font-medium text-foreground group-open:whitespace-normal">
                          {a.text}
                        </span>
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="flex flex-col gap-3 px-4 pb-4">
                        {a.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.imageUrl} alt="" className="ml-9 max-h-56 w-auto self-start rounded-lg border border-border" />
                        ) : null}
                        <div className="ml-9 grid gap-1.5">
                          {a.options.map((opt, i) => {
                            const isCorrect = i === a.correctIndex
                            const isChosen = a.selectedIndex === i
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
                                <span className="text-xs font-semibold text-muted-foreground">{letter(i)}</span>
                                {opt}
                                {isCorrect ? <Check className="ml-auto size-4 text-success" /> : null}
                                {isChosen && !isCorrect ? <X className="ml-auto size-4 text-destructive" /> : null}
                              </div>
                            )
                          })}
                        </div>
                        {a.explanation ? (
                          <div className="ml-9 rounded-lg border border-accent/20 bg-accent/10 p-3">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-foreground">
                              <Lightbulb className="size-3.5" />
                              Explanation
                            </div>
                            <p className="mt-1.5 text-sm leading-snug text-foreground">{a.explanation}</p>
                            {a.nextStep ? (
                              <p className="mt-2 text-sm leading-snug text-muted-foreground">
                                <span className="font-medium text-foreground">Next step:</span> {a.nextStep}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </details>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
