"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { ClientQuestion, SessionType, Topic } from "@/lib/domain"
import { MAX_HELP_PER_SESSION, SESSION_TYPE_CONFIG, TOPIC_LABELS } from "@/lib/domain"
import { submitAnswerAction, finishSessionAction, endSessionAction } from "@/app/(app)/practice/actions"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { Clock, Check, X, ChevronRight, ChevronLeft, Flag, Lightbulb } from "lucide-react"
import { SessionHelpDialog } from "@/components/app/session-help-dialog"

export interface PlayerSlot {
  position: number
  question: ClientQuestion
  answered: { selectedIndex: number; isCorrect: boolean; correctIndex: number } | null
}

type AnswerState = { selectedIndex: number; isCorrect: boolean; correctIndex: number }

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function PracticePlayer({
  sessionId,
  childName,
  sessionType,
  topic,
  slots,
  remainingSeconds,
  helpUsed: initialHelpUsed,
  adaptiveMix = null,
  calibrating = false,
}: {
  sessionId: string
  childName: string
  sessionType: SessionType
  topic: Topic | null
  slots: PlayerSlot[]
  remainingSeconds: number
  helpUsed: number
  /** Adaptive-only: formatted per-topic allocation (e.g. "5 Geometry, 4 Fractions"). */
  adaptiveMix?: string | null
  /** Adaptive-only: render the cold-start calibrating note. */
  calibrating?: boolean
}) {
  const total = slots.length
  const firstUnanswered = slots.findIndex((s) => !s.answered)
  const [index, setIndex] = useState(firstUnanswered === -1 ? 0 : firstUnanswered)
  const [answers, setAnswers] = useState<Record<number, AnswerState>>(() => {
    const init: Record<number, AnswerState> = {}
    for (const s of slots) if (s.answered) init[s.position] = s.answered
    return init
  })
  const [seconds, setSeconds] = useState(remainingSeconds)
  const [submitting, startSubmit] = useTransition()
  const [finishing, startFinish] = useTransition()
  const [cancelling, startCancel] = useTransition()
  const [helpUsed, setHelpUsed] = useState(initialHelpUsed)
  const finishedRef = useRef(false)
  const router = useRouter()

  const slot = slots[index]!
  const current = answers[slot.position] ?? null
  const answeredCount = Object.keys(answers).length

  const finish = useCallback(
    (reason: "completed" | "expired") => {
      if (finishedRef.current) return
      finishedRef.current = true
      startFinish(async () => {
        await finishSessionAction(sessionId, reason)
      })
    },
    [sessionId],
  )

  // Cancel/abandon the session WITHOUT scoring or generating a review. The
  // session is marked abandoned server-side and the parent returns to the
  // dashboard (Req: a cancelled session does not count or trigger the review).
  function cancelSession() {
    if (finishedRef.current) return
    finishedRef.current = true
    startCancel(async () => {
      const res = await endSessionAction(sessionId)
      if (res && "error" in res && res.error) {
        finishedRef.current = false
        toast.error(res.error)
        return
      }
      router.push("/dashboard")
    })
  }

  // Server-authoritative countdown. The deadline lives on the server; this is a
  // display + auto-submit convenience. The server also rejects any late answers.
  useEffect(() => {
    if (seconds <= 0) {
      finish("expired")
      return
    }
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [seconds, finish])

  function handleSelect(optionIndex: number) {
    if (current || submitting) return // already answered or in-flight
    startSubmit(async () => {
      const res = await submitAnswerAction(sessionId, slot.position, optionIndex)
      if (res.expired) {
        toast.info("Time's up!")
        finish("expired")
        return
      }
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong.")
        return
      }
      setAnswers((prev) => ({
        ...prev,
        [slot.position]: {
          selectedIndex: optionIndex,
          isCorrect: res.isCorrect!,
          correctIndex: res.correctIndex!,
        },
      }))
    })
  }

  const timeLow = seconds <= 60
  const config = SESSION_TYPE_CONFIG[sessionType]
  const isLast = index === total - 1
  const canFinish = answeredCount === total

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-3xl flex-col px-4 py-6 sm:px-6">
      {/* Header: progress + timer */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{childName}</span>
            <span aria-hidden>·</span>
            <span>{config.label}</span>
            {topic ? (
              <Badge variant="secondary" className="ml-1">
                {TOPIC_LABELS[topic]}
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums",
                timeLow ? "bg-destructive/10 text-destructive" : "bg-secondary text-foreground",
              )}
              role="timer"
              aria-live="off"
            >
              <Clock className="size-4" />
              {formatTime(seconds)}
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={cancelling || finishing} className="text-muted-foreground">
                  <X className="size-4" />
                  <span className="hidden sm:inline">Cancel</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this session?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This session will be discarded. It won&apos;t count towards {childName}&apos;s score or progress,
                    and no review will be generated. This can&apos;t be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={cancelling}>Keep practising</AlertDialogCancel>
                  <AlertDialogAction onClick={cancelSession} disabled={cancelling}>
                    {cancelling ? "Cancelling…" : "Cancel session"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Progress value={(answeredCount / total) * 100} className="h-2" />
          <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
            {answeredCount}/{total}
          </span>
        </div>

        {/* Adaptive explainability (Req 9.3/9.4): the per-topic mix and, for a
            cold-start child, a brief calibrating note. Non-intrusive and only
            present for adaptive sessions. */}
        {adaptiveMix || calibrating ? (
          <div className="flex flex-col gap-1.5">
            {adaptiveMix ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Today&apos;s mix:</span> {adaptiveMix}
              </p>
            ) : null}
            {calibrating ? (
              <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
                Calibrating — we&apos;re still learning your child&apos;s strengths, so this is a mixed warm-up across
                all topics.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Question */}
      <div className="mt-8 flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Question {index + 1} of {total}
          </p>
          <SessionHelpDialog
            sessionId={sessionId}
            questionId={slot.question.id}
            disabled={helpUsed >= MAX_HELP_PER_SESSION || current != null}
            helpRemaining={MAX_HELP_PER_SESSION - helpUsed}
            onUsed={() => setHelpUsed((n) => n + 1)}
            trigger={
              <Button variant="outline" size="sm" disabled={helpUsed >= MAX_HELP_PER_SESSION || current != null}>
                <Lightbulb className="size-4" />
                Show me how
                <span className="text-xs text-muted-foreground">
                  ({MAX_HELP_PER_SESSION - helpUsed} left)
                </span>
              </Button>
            }
          />
        </div>

        <h1 className="mt-3 text-balance font-heading text-xl font-semibold leading-snug text-foreground sm:text-2xl">
          {slot.question.text}
        </h1>

        {slot.question.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slot.question.imageUrl || "/placeholder.svg"}
            alt=""
            className="mt-4 max-h-64 w-auto self-start rounded-xl border border-border"
          />
        ) : null}

        {/* Options */}
        <div className="mt-6 grid gap-3" role="radiogroup" aria-label="Answer options">
          {slot.question.options.map((option, i) => {
            const isSelected = current?.selectedIndex === i
            const isCorrectOption = current && current.correctIndex === i
            const showWrong = current && isSelected && !current.isCorrect
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={!!current || submitting}
                onClick={() => handleSelect(i)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-xl border px-4 py-4 text-left text-sm font-medium transition-colors",
                  "disabled:cursor-default",
                  !current && "border-border bg-card hover:border-primary/50 hover:bg-secondary/50",
                  isCorrectOption && "border-success bg-success/10 text-foreground",
                  showWrong && "border-destructive bg-destructive/10 text-foreground",
                  current && !isCorrectOption && !showWrong && "border-border bg-card opacity-60",
                )}
              >
                <span className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                      isCorrectOption && "border-success bg-success text-success-foreground",
                      showWrong && "border-destructive bg-destructive text-destructive-foreground",
                      !isCorrectOption && !showWrong && "border-border text-muted-foreground",
                    )}
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  {option}
                </span>
                {isCorrectOption ? <Check className="size-5 text-success" /> : null}
                {showWrong ? <X className="size-5 text-destructive" /> : null}
              </button>
            )
          })}
        </div>

        {current ? (
          <div
            className={cn(
              "mt-4 rounded-xl border p-4 text-sm",
              current.isCorrect
                ? "border-success/30 bg-success/5 text-foreground"
                : "border-destructive/30 bg-destructive/5 text-foreground",
            )}
          >
            {current.isCorrect ? (
              <p className="font-medium text-success">Correct — well done!</p>
            ) : (
              <p className="font-medium text-destructive">
                Not quite. The right answer is {String.fromCharCode(65 + current.correctIndex)}. You&apos;ll get a
                full step-by-step explanation in your review at the end.
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* Footer nav */}
      <div className="sticky bottom-0 mt-6 flex items-center justify-between gap-3 border-t border-border bg-background/80 py-4 backdrop-blur">
        <Button
          variant="ghost"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
        >
          <ChevronLeft className="size-4" />
          Previous
        </Button>

        {canFinish || (isLast && current) ? (
          <Button onClick={() => finish("completed")} disabled={finishing}>
            <Flag className="size-4" />
            {finishing ? "Finishing…" : "Finish session"}
          </Button>
        ) : (
          <Button
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
            disabled={isLast}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
