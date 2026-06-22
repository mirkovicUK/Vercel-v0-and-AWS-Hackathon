import { TrendingDown } from "lucide-react"
import type { SettledSection } from "@/lib/db/admin-metrics"
import type { DecliningMasteryItem } from "@/lib/db/at-risk"
import { formatSignedSlope } from "@/lib/db/at-risk"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { MetricSection } from "@/components/app/admin/metric-section"

/**
 * Children whose recent mastery trend is strictly negative, steepest decline
 * first (the order the Insights_Service returned — Req 3.4). Each row shows the
 * child's `display_name`, the owning `parentEmail`, and the signed slope via
 * `formatSignedSlope` rendered as a rose-tinted at-risk signal (Req 3.1–3.3).
 *
 * The payload type carries *only* `{ childDisplayName, parentEmail, masterySlope }`,
 * so no forbidden attribute can be rendered — the type-level PII firewall.
 */
export function DecliningMasteryCard({ section }: { section: SettledSection<DecliningMasteryItem[]> }) {
  return (
    <MetricSection
      id="declining-mastery"
      title="Declining mastery"
      description="Children with a negative recent trend"
      icon={<TrendingDown className="size-5" />}
      accent="rose"
      hasError={!section.ok}
      preview={
        section.ok ? (
          <>
            {section.data.length}
            <span className="ml-1 text-xs font-normal text-muted-foreground">children</span>
          </>
        ) : null
      }
    >
      {section.ok ? (
        section.data.length === 0 ? (
          <Empty className="rounded-xl border border-dashed border-border py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TrendingDown className="size-6" />
              </EmptyMedia>
              <EmptyTitle>No declining mastery</EmptyTitle>
              <EmptyDescription>No children currently show a declining mastery trend.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {section.data.map((item, index) => (
              <li
                key={index}
                className="flex items-center justify-between gap-4 rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{item.childDisplayName}</span>
                  <span className="truncate text-xs text-muted-foreground">{item.parentEmail}</span>
                </div>
                <span className="shrink-0 rounded-lg bg-chart-4/10 px-2.5 py-1 font-heading text-sm font-bold tabular-nums text-chart-4">
                  {formatSignedSlope(item.masterySlope)}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </MetricSection>
  )
}
