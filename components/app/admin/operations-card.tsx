import { Activity, ScrollText, Webhook } from "lucide-react"
import type { OperationalMetrics, SettledSection } from "@/lib/db/admin-metrics"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { MetricSection, SubHeading } from "@/components/app/admin/metric-section"
import { formatAdminDateTime } from "@/components/app/admin/format"

function ActivityRow({ label, time }: { label: string; time: string }) {
  return (
    <li className="flex items-center justify-between gap-4 rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5">
      <span className="truncate font-mono text-xs text-foreground">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{time}</span>
    </li>
  )
}

/**
 * Operational health: the most recent processed webhook events (type + processed
 * date) and the most recent audit-log entries (action + created date). The raw
 * audit `detail` payload is never carried by `AuditEntry`, so it cannot leak
 * (Req 10.2, 10.4, 10.5).
 */
export function OperationsCard({ section }: { section: SettledSection<OperationalMetrics> }) {
  return (
    <MetricSection
      id="operations"
      title="Operations"
      description="Recent webhooks & audit activity"
      icon={<Webhook className="size-5" />}
      accent="slate"
      hasError={!section.ok}
      preview={
        section.ok ? (
          <>
            {section.data.recentWebhookEvents.length}
            <span className="ml-1 text-xs font-normal text-muted-foreground">events</span>
          </>
        ) : null
      }
    >
      {section.ok ? (
        <div className="flex flex-col gap-4">
          <div>
            <SubHeading>Webhook events</SubHeading>
            {section.data.recentWebhookEvents.length === 0 ? (
              <Empty className="rounded-xl border border-dashed border-border py-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Activity className="size-6" />
                  </EmptyMedia>
                  <EmptyTitle>No webhook events</EmptyTitle>
                  <EmptyDescription>Processed webhook events will appear here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {section.data.recentWebhookEvents.map((event, index) => (
                  <ActivityRow key={index} label={event.type} time={formatAdminDateTime(event.processedAt)} />
                ))}
              </ul>
            )}
          </div>

          <div>
            <SubHeading>Audit log</SubHeading>
            {section.data.recentAuditEntries.length === 0 ? (
              <Empty className="rounded-xl border border-dashed border-border py-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ScrollText className="size-6" />
                  </EmptyMedia>
                  <EmptyTitle>No audit entries</EmptyTitle>
                  <EmptyDescription>Recent audited actions will appear here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {section.data.recentAuditEntries.map((entry, index) => (
                  <ActivityRow key={index} label={entry.action} time={formatAdminDateTime(entry.createdAt)} />
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </MetricSection>
  )
}
