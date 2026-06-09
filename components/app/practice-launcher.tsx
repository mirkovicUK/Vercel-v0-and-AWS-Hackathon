"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { Child, SessionType, Topic } from "@/lib/domain"
import { SESSION_TYPE_CONFIG, SESSION_TYPES, TOPICS, TOPIC_LABELS } from "@/lib/domain"
import { startSessionAction, endSessionAction } from "@/app/(app)/practice/actions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ChildAvatar } from "@/components/app/child-avatar"
import { Spinner } from "@/components/ui/spinner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { Clock, ListChecks, Check } from "lucide-react"

export function PracticeLauncher({
  children,
  initialChildId,
  initialTopic,
}: {
  children: Child[]
  initialChildId?: string
  initialTopic?: Topic
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [childId, setChildId] = useState<string>(
    initialChildId && children.some((c) => c.id === initialChildId) ? initialChildId : (children[0]?.id ?? ""),
  )
  const [type, setType] = useState<SessionType>(initialTopic ? "topic" : "warmup")
  const [topic, setTopic] = useState<Topic>(initialTopic ?? TOPICS[0])
  // When a child already has an active session, the start action returns it so we
  // can offer Resume or End-and-restart instead of silently doing nothing.
  const [activeSession, setActiveSession] = useState<{ id: string; childId: string } | null>(null)

  function submitStart() {
    const fd = new FormData()
    fd.set("childId", childId)
    fd.set("type", type)
    if (type === "topic") fd.set("topic", topic)
    startTransition(async () => {
      const res = await startSessionAction(fd)
      if (res && "error" in res && res.error) {
        toast.error(res.error)
        return
      }
      if (res && "activeSession" in res && res.activeSession?.id) {
        // A session is already running for this child — ask what to do.
        setActiveSession(res.activeSession)
        return
      }
      // On success the action redirects into the player.
    })
  }

  function onResume() {
    if (!activeSession) return
    router.push(`/practice/${activeSession.id}`)
  }

  function onEndAndRestart() {
    if (!activeSession) return
    const sessionId = activeSession.id
    startTransition(async () => {
      const res = await endSessionAction(sessionId)
      if (res && "error" in res && res.error) {
        toast.error(res.error)
        return
      }
      setActiveSession(null)
      // Old session ended — start the new one the parent originally requested.
      submitStart()
    })
  }

  function onStart() {
    if (!childId) {
      toast.error("Please choose a child first.")
      return
    }
    submitStart()
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Choose child */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Who&apos;s practising?</h2>
        <div className="flex flex-wrap gap-3">
          {children.map((c) => {
            const selected = c.id === childId
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setChildId(c.id)}
                aria-pressed={selected}
                className={cn(
                  "flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-colors",
                  selected ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/40",
                )}
              >
                <ChildAvatar name={c.displayName} color={c.avatarColor} className="size-9 text-sm" />
                <div>
                  <p className="text-sm font-medium text-foreground">{c.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.yearGroup ? `Year ${c.yearGroup}` : "11+ prep"}
                  </p>
                </div>
                {selected ? <Check className="ml-1 size-4 text-primary" /> : null}
              </button>
            )
          })}
        </div>
      </section>

      {/* Choose session type */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Choose a session</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {SESSION_TYPES.map((t) => {
            const config = SESSION_TYPE_CONFIG[t]
            const selected = t === type
            return (
              <button key={t} type="button" onClick={() => setType(t)} aria-pressed={selected} className="text-left">
                <Card
                  className={cn(
                    "h-full transition-colors",
                    selected ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/40",
                  )}
                >
                  <CardContent className="flex flex-col gap-2 p-4">
                    <p className="font-heading text-sm font-semibold text-foreground">{config.label}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{config.description}</p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <ListChecks className="size-3.5" />
                        {config.questionCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3.5" />
                        {config.timeLimitSeconds / 60} min
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </button>
            )
          })}
        </div>
      </section>

      {/* Choose topic (only for topic sessions) */}
      {type === "topic" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">Which topic?</h2>
          <div className="flex flex-wrap gap-2">
            {TOPICS.map((t) => {
              const selected = t === topic
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTopic(t)}
                  aria-pressed={selected}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:border-primary/40",
                  )}
                >
                  {TOPIC_LABELS[t]}
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          The timer starts as soon as the session begins and runs on our server, so closing the tab won&apos;t pause
          it.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/dashboard")} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onStart} disabled={pending || !childId}>
            {pending ? (
              <>
                <Spinner className="size-4" /> Starting…
              </>
            ) : (
              "Start session"
            )}
          </Button>
        </div>
      </div>

      <AlertDialog open={activeSession != null} onOpenChange={(open) => !open && setActiveSession(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>A session is already in progress</AlertDialogTitle>
            <AlertDialogDescription>
              This child already has an unfinished practice session. You can resume it, or end it and start a new one.
              Ending it will mark the current session as abandoned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep choosing</AlertDialogCancel>
            <Button variant="outline" onClick={onResume} disabled={pending}>
              Resume session
            </Button>
            <AlertDialogAction onClick={onEndAndRestart} disabled={pending}>
              {pending ? (
                <>
                  <Spinner className="size-4" /> Working…
                </>
              ) : (
                "End & start new"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
