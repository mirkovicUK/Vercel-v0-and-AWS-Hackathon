"use client"

import { useState } from "react"
import { experimental_useObject as useObject } from "@ai-sdk/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { Sparkles, TrendingUp, Target, ArrowRight } from "lucide-react"
import { reportSchema } from "@/lib/ai/report"

export function ReviewReportDialog({ childId, childName }: { childId: string; childName: string }) {
  const [open, setOpen] = useState(false)

  const { object, submit, isLoading, error, stop } = useObject({
    api: "/api/children/report",
    schema: reportSchema,
    onError: () => toast.error("Could not generate a report right now. Please try again shortly."),
  })

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next && !object && !isLoading) submit({ childId })
    if (!next && isLoading) stop()
  }

  // Partial object streams in field-by-field; guard everything.
  const momentum = object?.momentum
  const summary = object?.summary
  const strengths = (object?.strengths ?? []).filter((s): s is string => Boolean(s && s.trim()))
  const focusAreas = (object?.focusAreas ?? []).filter((f) => f && (f.topic || f.advice))
  const nextSteps = (object?.nextSteps ?? []).filter((s): s is string => Boolean(s && s.trim()))
  const showSpinner = isLoading && !summary && !momentum

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Sparkles className="size-4 text-accent-foreground" />
          AI review report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-accent/15">
              <Sparkles className="size-4 text-accent-foreground" />
            </span>
            {childName}&apos;s review report
          </DialogTitle>
          <DialogDescription>An AI summary of progress, generated from practice results.</DialogDescription>
        </DialogHeader>

        {showSpinner ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Analysing recent sessions…
          </div>
        ) : error && !summary ? (
          <div className="py-8 text-sm text-muted-foreground">
            Could not generate a report right now. Please try again.
          </div>
        ) : (
          <div className="flex flex-col gap-6 py-1">
            {momentum ? (
              <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <TrendingUp className="mt-0.5 size-4 shrink-0 text-primary" />
                <p className="text-sm font-medium text-foreground">{momentum}</p>
              </div>
            ) : null}

            {summary ? <p className="text-pretty text-sm leading-relaxed text-foreground">{summary}</p> : null}

            {strengths.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <TrendingUp className="size-4 text-success" />
                  Strengths
                </h3>
                <ul className="flex flex-col gap-1.5 pl-1">
                  {strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" />
                      {s}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {focusAreas.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Target className="size-4 text-primary" />
                  Areas to focus on
                </h3>
                <ul className="flex flex-col gap-3">
                  {focusAreas.map((f, i) => (
                    <li key={i} className="rounded-lg border border-border bg-muted/40 p-3">
                      {f?.topic ? <p className="text-sm font-medium text-foreground">{f.topic}</p> : null}
                      {f?.advice ? <p className="mt-0.5 text-sm text-muted-foreground">{f.advice}</p> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {nextSteps.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">Recommended next steps</h3>
                <ul className="flex flex-col gap-1.5">
                  {nextSteps.map((n, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" />
                      {n}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => submit({ childId })}
              disabled={isLoading}
              className="self-start text-muted-foreground"
            >
              {isLoading ? "Generating…" : "Regenerate"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
