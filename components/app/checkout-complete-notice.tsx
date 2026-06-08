"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { CheckCircle2, RefreshCw } from "lucide-react"

const AUTO_REFRESH_DELAY_MS = 4000

/**
 * Shown on the billing page after Stripe redirects back to `?status=complete`
 * (Req 18.4). Entitlement updates arrive asynchronously via the Stripe webhook,
 * so the plan may not read as active the instant the customer lands here.
 *
 * - When already entitled, we show a brief success confirmation.
 * - When not yet entitled, we auto-retry `router.refresh()` once after a short
 *   delay and always expose a manual "Refresh" action plus explicit fallback
 *   navigation links, so the Parent is never left without a path forward.
 */
export function CheckoutCompleteNotice({ entitled }: { entitled: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [autoRetried, setAutoRetried] = useState(false)

  useEffect(() => {
    if (entitled || autoRetried) return
    const timer = setTimeout(() => {
      setAutoRetried(true)
      startTransition(() => {
        router.refresh()
      })
    }, AUTO_REFRESH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [entitled, autoRetried, router])

  function handleRefresh() {
    startTransition(() => {
      router.refresh()
    })
  }

  if (entitled) {
    return (
      <Card className="border-success/30 bg-success/5">
        <CardContent className="flex items-center gap-3 py-4">
          <CheckCircle2 className="size-5 shrink-0 text-success" />
          <div className="text-sm">
            <p className="font-medium text-foreground">You&apos;re all set.</p>
            <p className="text-muted-foreground">Your plan is active. Thanks for subscribing.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex items-center gap-3">
          <Spinner className="size-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Finishing up…</p>
            <p className="text-muted-foreground">
              We&apos;re confirming your payment. This usually takes a few seconds.
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          If your plan isn&apos;t showing yet, refresh — or use the links below if this page doesn&apos;t update.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={pending} className="gap-2">
            {pending ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
            Refresh
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/billing">Reload billing</Link>
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
