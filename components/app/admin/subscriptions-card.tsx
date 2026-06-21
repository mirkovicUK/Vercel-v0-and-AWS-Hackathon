import { SUBSCRIPTION_STATUSES } from "@/lib/domain"
import type { SubscriptionStatus } from "@/lib/domain"
import type { SettledSection, SubscriptionMetrics } from "@/lib/db/admin-metrics"
import { SectionCard, StatRow } from "@/components/app/admin/section-card"

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
    <SectionCard title="Subscriptions" description="Counts by status" section={section}>
      {(subscriptions) => (
        <div className="flex flex-col divide-y divide-border">
          {SUBSCRIPTION_STATUSES.map((status) => (
            <StatRow key={status} label={STATUS_LABELS[status]} value={subscriptions.byStatus[status]} />
          ))}
          <StatRow label="Set to cancel at period end" value={subscriptions.cancelAtPeriodEnd} />
        </div>
      )}
    </SectionCard>
  )
}
