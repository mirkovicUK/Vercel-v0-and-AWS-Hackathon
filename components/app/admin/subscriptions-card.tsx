import { CreditCard } from "lucide-react"
import { SUBSCRIPTION_STATUSES } from "@/lib/domain"
import type { SubscriptionStatus } from "@/lib/domain"
import type { SettledSection, SubscriptionMetrics } from "@/lib/db/admin-metrics"
import { MetricSection, StatChip, StatGrid, StatTile } from "@/components/app/admin/metric-section"

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
  unpaid: "Unpaid",
}

/**
 * Subscription counts for all six statuses (each present, 0 when absent) plus the
 * count of subscriptions set to cancel at period end (Req 6.2–6.4).
 */
export function SubscriptionsCard({ section }: { section: SettledSection<SubscriptionMetrics> }) {
  return (
    <MetricSection
      id="subscriptions"
      title="Subscriptions"
      description="Counts by status"
      icon={<CreditCard className="size-5" />}
      accent="blue"
      hasError={!section.ok}
      preview={
        section.ok ? (
          <>
            {section.data.byStatus.active}
            <span className="ml-1 text-xs font-normal text-muted-foreground">active</span>
          </>
        ) : null
      }
    >
      {section.ok ? (
        <div className="flex flex-col gap-4">
          <StatGrid cols={3}>
            {SUBSCRIPTION_STATUSES.map((status) => (
              <StatChip key={status} label={STATUS_LABELS[status]} value={section.data.byStatus[status]} />
            ))}
          </StatGrid>
          <StatTile label="Set to cancel at period end" value={section.data.cancelAtPeriodEnd} highlight />
        </div>
      ) : null}
    </MetricSection>
  )
}
