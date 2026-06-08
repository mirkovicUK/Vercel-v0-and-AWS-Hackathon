"use client"

import { useCallback, useState } from "react"
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js"
import { loadStripe } from "@stripe/stripe-js"
import { startSubscriptionCheckout } from "@/app/(app)/billing/actions"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sparkles } from "lucide-react"

// The publishable key is required to mount Stripe.js. When it is missing we must
// NOT call loadStripe("") and mount a broken EmbeddedCheckout — we surface an
// error instead (Req 18.2).
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null

const GENERIC_CHECKOUT_ERROR = "Could not start checkout. Please try again."

export function SubscriptionCheckout({ ctaLabel = "Start 7-day free trial" }: { ctaLabel?: string }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchClientSecret = useCallback(async () => {
    // Reset any stale error before a fresh attempt.
    setError(null)
    try {
      const res = await startSubscriptionCheckout()
      if (res.error || !res.clientSecret) {
        setError(res.error ?? GENERIC_CHECKOUT_ERROR)
        // Throwing prevents EmbeddedCheckoutProvider from mounting with a bad secret.
        throw new Error(res.error ?? "no client secret")
      }
      return res.clientSecret
    } catch (err) {
      // Network/server failures must also land on our error path, never a broken mount.
      setError((prev) => prev ?? (err instanceof Error && err.message ? err.message : GENERIC_CHECKOUT_ERROR))
      throw err
    }
  }, [])

  // Stripe.js could not be initialised (publishable key absent) — treat as the
  // error path so we never mount the embedded UI in a broken state (Req 18.2).
  const configError = stripePromise
    ? null
    : "Billing is not configured yet. Please try again later."
  const shownError = configError ?? error

  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)} className="gap-2">
        <Sparkles className="size-4" />
        {ctaLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-border p-5">
            <DialogTitle>Start your plan</DialogTitle>
          </DialogHeader>
          <div className="p-5">
            {shownError ? (
              <p className="text-sm text-destructive" role="alert">
                {shownError}
              </p>
            ) : (
              <EmbeddedCheckoutProvider stripe={stripePromise} options={{ fetchClientSecret }}>
                <div className="min-h-[24rem]">
                  <EmbeddedCheckout />
                </div>
              </EmbeddedCheckoutProvider>
            )}
            {!shownError ? (
              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3" />
                Secure checkout by Stripe
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
