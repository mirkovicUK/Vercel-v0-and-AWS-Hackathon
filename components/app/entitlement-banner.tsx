import Link from "next/link"
import type { Entitlement } from "@/lib/db/subscriptions"
import { Button } from "@/components/ui/button"
import { Clock, AlertTriangle } from "lucide-react"

function daysLeft(iso: string | null): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return ms <= 0 ? 0 : Math.ceil(ms / (1000 * 60 * 60 * 24))
}

export function EntitlementBanner({ entitlement }: { entitlement: Entitlement }) {
  // Trialing/active but set to cancel at period end: access continues until the
  // period ends, but we tell the parent it won't renew (Stripe keeps the status
  // entitled until customer.subscription.deleted fires at period end).
  if (entitlement.entitled && entitlement.cancelAtPeriodEnd) {
    const left = daysLeft(entitlement.currentPeriodEnd)
    return (
      <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Clock className="size-5 shrink-0 text-primary" />
          <p className="text-sm text-foreground">
            Your plan is set to cancel
            {left != null ? <> — access continues for {left} more {left === 1 ? "day" : "days"}</> : null}. Resubscribe
            any time to keep access without interruption.
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link href="/billing">Manage plan</Link>
        </Button>
      </div>
    )
  }

  // Trialing: friendly reminder with days left.
  if (entitlement.status === "trialing") {
    const left = daysLeft(entitlement.currentPeriodEnd)
    return (
      <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Clock className="size-5 shrink-0 text-primary" />
          <p className="text-sm text-foreground">
            You&apos;re on a free trial{left != null ? <> — {left} {left === 1 ? "day" : "days"} left</> : null}. Your
            plan starts automatically when the trial ends. Cancel any time before then and you won&apos;t be charged.
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link href="/billing">Manage plan</Link>
        </Button>
      </div>
    )
  }

  if (!entitlement.entitled) {
    const message =
      entitlement.reason === "past_due"
        ? "Your last payment didn't go through. Update your payment method to restore practice sessions."
        : entitlement.reason === "no_subscription"
          ? "Start your free trial to begin practising and tracking progress."
          : "Your access has ended. Resubscribe to continue practising — your children's profiles and progress are preserved."
    const cta = entitlement.reason === "no_subscription" ? "Start free trial" : "Resubscribe"
    return (
      <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-5 shrink-0 text-destructive" />
          <p className="text-sm text-foreground">{message}</p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href="/billing">{cta}</Link>
        </Button>
      </div>
    )
  }

  return null
}
