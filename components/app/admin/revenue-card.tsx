import { formatPrice } from "@/lib/plans"
import type { RevenueSummary } from "@/lib/db/revenue"
import type { SettledSection } from "@/lib/db/admin-metrics"
import { SectionCard, StatHero, StatRow } from "@/components/app/admin/section-card"
import { formatAdminDate } from "@/components/app/admin/format"

/**
 * Revenue overview: total revenue (formatted GBP), paying-parent count, and the
 * first-paid date. A zero summary renders £0.00 and 0 because `formatPrice(0)`
 * yields "£0.00" and the count is shown verbatim (Req 4.1–4.4).
 */
export function RevenueCard({ section }: { section: SettledSection<RevenueSummary> }) {
  return (
    <SectionCard title="Revenue" description="Lifetime paid performance" section={section}>
      {(revenue) => (
        <div className="flex flex-col gap-4">
          <StatHero label="total revenue" value={formatPrice(revenue.totalRevenuePence)} />
          <div className="flex flex-col divide-y divide-border">
            <StatRow label="Paying parents" value={revenue.payingParentCount} />
            <StatRow label="First paid" value={formatAdminDate(revenue.firstPaidAt)} />
          </div>
        </div>
      )}
    </SectionCard>
  )
}
