"use client"

import { useActionState, useEffect, useState } from "react"
import { createChildAction, type ChildActionState } from "@/app/(app)/children/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SubmitButton } from "@/components/auth/submit-button"
import { ChildAvatar } from "@/components/app/child-avatar"
import { AlertCircle, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { YEAR_GROUPS } from "@/lib/domain"

const initial: ChildActionState = { ok: false }
const COLORS = ["teal", "blue", "amber", "rose", "emerald", "indigo"]

export function AddChildDialog({
  triggerVariant = "default",
  triggerLabel = "Add a child",
}: {
  triggerVariant?: "default" | "outline"
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [color, setColor] = useState("teal")
  const [name, setName] = useState("")
  const [state, action] = useActionState(createChildAction, initial)

  useEffect(() => {
    if (state.ok) {
      setOpen(false)
      setName("")
      setColor("teal")
    }
  }, [state.ok])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant}>
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a child</DialogTitle>
          <DialogDescription>
            Create a profile so you can track their progress separately. You can add up to three children.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          {state.error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{state.error}</span>
            </div>
          ) : null}

          <div className="flex items-center gap-4">
            <ChildAvatar name={name || "?"} color={color} className="size-14 text-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="displayName">Name or nickname</Label>
              <Input
                id="displayName"
                name="displayName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Amara"
                maxLength={40}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="yearGroup">Year group (optional)</Label>
            <Select name="yearGroup">
              <SelectTrigger id="yearGroup">
                <SelectValue placeholder="Select year group" />
              </SelectTrigger>
              <SelectContent>
                {YEAR_GROUPS.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    Year {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Avatar colour</Label>
            <input type="hidden" name="avatarColor" value={color} />
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Choose ${c}`}
                  aria-pressed={color === c}
                  className={cn(
                    "rounded-full ring-offset-2 transition",
                    color === c ? "ring-2 ring-ring" : "ring-0",
                  )}
                >
                  <ChildAvatar name={name || "?"} color={c} className="size-9 text-xs" />
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <SubmitButton pendingText="Adding...">Add child</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
