import { Clock } from "lucide-react"
import type { SettledSection } from "@/lib/db/admin-metrics"
import type { TrialEndingItem } from "@/lib/db/at-risk"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { MetricSection } from "@/components/app/admin/metric-section"

/**
 * Parents whose trial ends within the next few days, soonest-ending first (the
 * order the Insights_Service returned — Req 5.3). Each row shows the owning
 * `parentEmail` and a days-remaining label (Req 5.1, 5.2).
 *
 * The payload type carries *only* `{ parentEmail, daysRemaining, trialEnd }`,
 * so no forbidden attribute can be rendered — the type-level PII firewall.
 */
export function TrialsEndingCard({ section }: { section: SettledSection<TrialEndingItem[]> }) {
  return (
    <MetricSection
      id="trials-ending"
      title="Trials ending soon"
      description="Trials ending in the next 3 days"
      icon={<Clock className="size-5" />}
      accent="amber"
      hasError={!section.ok}
      preview={
        section.ok ? (
          <>
            {section.data.length}
            <span className="ml-1 text-xs font-normal text-muted-foreground">trials</span>
          </>
        ) : null
      }
    >
      {section.ok ? (
        section.data.length === 0 ? (
          <Empty className="rounded-xl border border-dashed border-border py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Clock className="size-6" />
              </EmptyMedia>
              <EmptyTitle>No trials ending soon</EmptyTitle>
              <EmptyDescription>No trials are ending in the next 3 days.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {section.data.map((item, index) => (
              <li
                key={index}
                className="flex items-center justify-between gap-4 rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5"
              >
                <span className="min-w-0 truncate text-sm font-medium text-foreground">{item.parentEmail}</span>
                <span className="shrink-0 rounded-lg bg-accent/20 px-2.5 py-1 font-heading text-sm font-bold tabular-nums text-accent-foreground">
                  {item.daysRemaining} day(s) left
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </MetricSection>
  )
}
