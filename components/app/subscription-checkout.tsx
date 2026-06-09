"use client"

import { useState, useTransition } from "react"
import { startSubscriptionCheckout } from "@/app/(app)/billing/actions"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Sparkles } from "lucide-react"

const GENERIC_CHECKOUT_ERROR = "Could not start checkout. Please try again."

/**
 * Subscribe CTA. Starts a Stripe-hosted Checkout session and redirects the
 * browser to Stripe's payment page. On completion Stripe redirects back to
 * /billing?status=complete; on cancel to /billing?status=cancelled.
 */
export function SubscriptionCheckout({ ctaLabel = "Start 7-day free trial" }: { ctaLabel?: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await startSubscriptionCheckout()
        if (res.url) {
          // Hand off to Stripe's hosted checkout page.
          window.location.href = res.url
        } else {
          setError(res.error ?? GENERIC_CHECKOUT_ERROR)
        }
      } catch {
        setError(GENERIC_CHECKOUT_ERROR)
      }
    })
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button size="lg" onClick={handleClick} disabled={pending} className="gap-2">
        {pending ? <Spinner className="size-4" /> : <Sparkles className="size-4" />}
        {pending ? "Starting…" : ctaLabel}
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
