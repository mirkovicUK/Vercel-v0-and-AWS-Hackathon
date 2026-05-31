"use client"

import { useState } from "react"
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
import { generateReviewReport, type ReviewReport } from "@/app/(app)/children/report-actions"

export function ReviewReportDialog({ childId, childName }: { childId: string; childName: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<ReviewReport | null>(null)

  async function run() {
    setLoading(true)
    setReport(null)
    const res = await generateReviewReport(childId)
    setLoading(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setReport(res.report)
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next && !report && !loading) void run()
  }

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

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Analysing recent sessions…
          </div>
        ) : report ? (
          <div className="flex flex-col gap-6 py-1">
            <p className="text-pretty text-sm leading-relaxed text-foreground">{report.summary}</p>

            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <TrendingUp className="size-4 text-success" />
                Strengths
              </h3>
              <ul className="flex flex-col gap-1.5 pl-1">
                {report.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" />
                    {s}
                  </li>
                ))}
              </ul>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Target className="size-4 text-primary" />
                Areas to focus on
              </h3>
              <ul className="flex flex-col gap-3">
                {report.focusAreas.map((f, i) => (
                  <li key={i} className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className="text-sm font-medium text-foreground">{f.topic}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{f.advice}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-foreground">Recommended next steps</h3>
              <ul className="flex flex-col gap-1.5">
                {report.nextSteps.map((n, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" />
                    {n}
                  </li>
                ))}
              </ul>
            </section>

            <Button variant="ghost" size="sm" onClick={run} className="self-start text-muted-foreground">
              Regenerate
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
