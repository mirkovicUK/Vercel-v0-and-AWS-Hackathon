import { PoundSterling } from "lucide-react"
import { formatPrice } from "@/lib/plans"
import type { RevenueSummary } from "@/lib/db/revenue"
import type { SettledSection } from "@/lib/db/admin-metrics"
import { MetricSection, StatHero, StatGrid, StatTile } from "@/components/app/admin/metric-section"
import { formatAdminDate } from "@/components/app/admin/format"

/**
 * Revenue overview: total revenue (formatted GBP), paying-parent count, and the
 * first-paid date. A zero summary renders £0.00 and 0 because `formatPrice(0)`
 * yields "£0.00" and the count is shown verbatim (Req 4.1–4.4).
 */
export function RevenueCard({ section }: { section: SettledSection<RevenueSummary> }) {
  return (
    <MetricSection
      id="revenue"
      title="Revenue"
      description="Lifetime paid performance"
      icon={<PoundSterling className="size-5" />}
      accent="emerald"
      hasError={!section.ok}
      preview={section.ok ? formatPrice(section.data.totalRevenuePence) : null}
    >
      {section.ok ? (
        <div className="flex flex-col gap-4">
          <StatHero label="total revenue" value={formatPrice(section.data.totalRevenuePence)} accent="emerald" />
          <StatGrid>
            <StatTile label="Paying parents" value={section.data.payingParentCount} />
            <StatTile label="First paid" value={formatAdminDate(section.data.firstPaidAt)} />
          </StatGrid>
        </div>
      ) : null}
    </MetricSection>
  )
}
