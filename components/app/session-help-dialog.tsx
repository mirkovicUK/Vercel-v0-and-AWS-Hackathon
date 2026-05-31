"use client"

import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { Lightbulb } from "lucide-react"

/**
 * "Show me how" AI tutor. Streams a step-by-step explanation for the current
 * question from the server. The server holds the question + correct answer and
 * never trusts client-supplied content, so this only sends identifiers.
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
  const [requested, setRequested] = useState(false)

  async function requestHelp() {
    setLoading(true)
    setExplanation("")
    setRequested(true)
    try {
      const res = await fetch("/api/practice/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, questionId }),
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
      setRequested(false)
    } finally {
      setLoading(false)
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next && !requested && !disabled) void requestHelp()
  }

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
            Thinking through the steps…
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{explanation}</div>
        )}
      </DialogContent>
    </Dialog>
  )
}
