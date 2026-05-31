"use client"

import { useState, useTransition } from "react"
import { openBillingPortal } from "@/app/(app)/billing/actions"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { ExternalLink } from "lucide-react"

export function ManagePlanButton({
  variant = "outline",
  label = "Manage plan",
}: {
  variant?: "default" | "outline"
  label?: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const res = await openBillingPortal()
      if (res.url) {
        window.location.href = res.url
      } else {
        setError(res.error ?? "Could not open billing portal.")
      }
    })
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant={variant} onClick={handleClick} disabled={pending} className="gap-2">
        {pending ? <Spinner className="size-4" /> : <ExternalLink className="size-4" />}
        {label}
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
