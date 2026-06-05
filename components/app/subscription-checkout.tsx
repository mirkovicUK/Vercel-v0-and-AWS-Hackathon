"use client"

import { useCallback, useState } from "react"
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js"
import { loadStripe } from "@stripe/stripe-js"
import { startSubscriptionCheckout } from "@/app/(app)/billing/actions"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sparkles } from "lucide-react"

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "")

export function SubscriptionCheckout({ ctaLabel = "Start 7-day free trial" }: { ctaLabel?: string }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchClientSecret = useCallback(async () => {
    const res = await startSubscriptionCheckout()
    if (res.error || !res.clientSecret) {
      setError(res.error ?? "Could not start checkout. Please try again.")
      throw new Error(res.error ?? "no client secret")
    }
    return res.clientSecret
  }, [])

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
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : (
              <EmbeddedCheckoutProvider stripe={stripePromise} options={{ fetchClientSecret }}>
                <div className="min-h-[24rem]">
                  <EmbeddedCheckout />
                </div>
              </EmbeddedCheckoutProvider>
            )}
            {!error ? (
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
