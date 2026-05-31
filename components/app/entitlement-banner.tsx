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
  // Trialing: friendly reminder with days left.
  if (entitlement.status === "trialing") {
    const left = daysLeft(entitlement.currentPeriodEnd ?? entitlement.currentPeriodEnd)
    return (
      <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Clock className="size-5 shrink-0 text-primary" />
          <p className="text-sm text-foreground">
            You&apos;re on a free trial{left != null ? <> — {left} {left === 1 ? "day" : "days"} left</> : null}. Add a
            payment method any time to keep access without interruption.
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
        : "Your plan has ended. Reactivate to continue practising and tracking progress."
    return (
      <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-5 shrink-0 text-destructive" />
          <p className="text-sm text-foreground">{message}</p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href="/billing">Reactivate plan</Link>
        </Button>
      </div>
    )
  }

  return null
}
