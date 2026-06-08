import { requireOnboardedParent } from "@/lib/auth/guard"
import { getEntitlement } from "@/lib/db/subscriptions"
import { PLAN, formatPrice } from "@/lib/plans"
import { SubscriptionCheckout } from "@/components/app/subscription-checkout"
import { ManagePlanButton } from "@/components/app/manage-plan-button"
import { CheckoutCompleteNotice } from "@/components/app/checkout-complete-notice"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Check, ArrowLeft } from "lucide-react"
import Link from "next/link"

export const metadata = { title: "Billing — ApexMaths" }

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  trialing: { label: "Free trial", tone: "bg-primary/10 text-primary" },
  active: { label: "Active", tone: "bg-success/15 text-success" },
  past_due: { label: "Payment due", tone: "bg-destructive/10 text-destructive" },
  canceled: { label: "Canceled", tone: "bg-muted text-muted-foreground" },
  unpaid: { label: "Unpaid", tone: "bg-destructive/10 text-destructive" },
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const parent = await requireOnboardedParent()
  const entitlement = await getEntitlement(parent.id)
  const hasPlan = entitlement.status !== null
  const status = entitlement.status ? STATUS_LABEL[entitlement.status] : null
  const justCompleted = (await searchParams).status === "complete"

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to dashboard
      </Link>

      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Plan &amp; billing</h1>
      <p className="mt-1 text-pretty text-muted-foreground">
        Manage your ApexMaths subscription. Cancel any time from the billing portal.
      </p>

      <div className="mt-8 grid gap-6">
        {/* Completion confirmation after returning from embedded checkout (Req 18.4) */}
        {justCompleted ? <CheckoutCompleteNotice entitled={entitlement.entitled} /> : null}

        {/* Current status */}
        {hasPlan ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Current plan</CardTitle>
              {status ? (
                <Badge className={`rounded-full border-0 ${status.tone}`}>{status.label}</Badge>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between">
                <span className="font-heading text-lg font-semibold text-foreground">{PLAN.name}</span>
                <span className="text-sm text-muted-foreground">
                  {formatPrice(PLAN.priceInPence)} / {PLAN.interval}
                </span>
              </div>
              <dl className="grid gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">
                    {entitlement.status === "trialing"
                      ? "Trial ends"
                      : entitlement.status === "canceled"
                        ? "Access until"
                        : "Renews on"}
                  </dt>
                  <dd className="font-medium text-foreground tabular-nums">
                    {formatDate(entitlement.currentPeriodEnd)}
                  </dd>
                </div>
              </dl>
              <div className="pt-1">
                <ManagePlanButton />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Plan offer */}
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base">{hasPlan ? "Your plan includes" : "Start your free trial"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {!hasPlan ? (
              <div className="flex items-baseline gap-2">
                <span className="font-heading text-3xl font-bold text-foreground">{formatPrice(PLAN.priceInPence)}</span>
                <span className="text-muted-foreground">/ month after {PLAN.trialDays}-day free trial</span>
              </div>
            ) : null}
            <ul className="grid gap-2.5">
              {PLAN.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {!hasPlan || !entitlement.entitled ? (
              <div>
                <SubscriptionCheckout ctaLabel={hasPlan ? "Reactivate plan" : `Start ${PLAN.trialDays}-day free trial`} />
                <p className="mt-2 text-xs text-muted-foreground">
                  No charge during your trial. Cancel any time before it ends and you won&apos;t be billed.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
