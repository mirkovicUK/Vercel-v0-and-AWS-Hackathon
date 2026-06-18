"use client"

import { useEffect, useState, type ReactNode } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Lightbulb, RefreshCw } from "lucide-react"

/**
 * "Show me how" AI tutor. Streams a step-by-step explanation for the current
 * question from the server. The server holds the question + correct answer and
 * never trusts client-supplied content, so this only sends identifiers (plus,
 * on a retry, the previously shown hints so the model can try a DIFFERENT
 * approach — "adaptive hints").
 */
export function SessionHelpDialog({
  sessionId,
  questionId,
  trigger,
  disabled,
  helpRemaining,
  onUsed,
}: {
  sessionId: string
  questionId: string
  trigger: ReactNode
  disabled?: boolean
  helpRemaining: number
  onUsed?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [explanation, setExplanation] = useState("")
  // Every hint shown for THIS question, oldest→newest. Sent back on a retry so
  // the model can pick a genuinely different (still correct) approach.
  const [priorHints, setPriorHints] = useState<string[]>([])
  const [requested, setRequested] = useState(false)

  // Reset cached state whenever the question changes, so moving to the next
  // question fetches a fresh hint instead of showing the previous one.
  useEffect(() => {
    setExplanation("")
    setPriorHints([])
    setRequested(false)
    setLoading(false)
  }, [questionId])

  // `retry` controls whether we ask for a different approach and bill another hint.
  async function requestHelp(retry: boolean) {
    setLoading(true)
    // Preserve the just-shown hint so the model is told what to avoid repeating.
    const history = retry && explanation.trim() ? [...priorHints, explanation.trim()] : priorHints
    if (retry && explanation.trim()) setPriorHints(history)
    setExplanation("")
    setRequested(true)
    try {
      const res = await fetch("/api/practice/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, questionId, previousHints: retry ? history : undefined }),
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Could not load an explanation.")
      }
      onUsed?.()
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setExplanation((prev) => prev + decoder.decode(value, { stream: true }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load an explanation.")
      if (!retry) setRequested(false)
    } finally {
      setLoading(false)
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next && !requested && !disabled) void requestHelp(false)
  }

  // A retry is possible once a hint has streamed in, the child still has hints
  // left, and we're not mid-stream.
  const canRetry = requested && !loading && explanation.trim().length > 0 && helpRemaining > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-accent/15">
              <Lightbulb className="size-4 text-accent-foreground" />
            </span>
            Show me how
          </DialogTitle>
          <DialogDescription>
            A step-by-step walkthrough — try to follow each step, then have another go. {helpRemaining} hint
            {helpRemaining === 1 ? "" : "s"} left this session.
          </DialogDescription>
        </DialogHeader>

        {loading && !explanation ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {priorHints.length > 0 ? "Thinking of another way to explain…" : "Thinking through the steps…"}
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{explanation}</div>
        )}

        {canRetry ? (
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">Still stuck? Try the same idea explained a different way.</p>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => void requestHelp(true)}>
              <RefreshCw className="size-4" />
              Try a different way
              <span className="text-xs text-muted-foreground">({helpRemaining} left)</span>
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
