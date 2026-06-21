import { Activity, ScrollText } from "lucide-react"
import type { OperationalMetrics, SettledSection } from "@/lib/db/admin-metrics"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { SectionCard } from "@/components/app/admin/section-card"
import { formatAdminDateTime } from "@/components/app/admin/format"

/**
 * Operational health: the most recent processed webhook events (type + processed
 * date) and the most recent audit-log entries (action + created date). The raw
 * audit `detail` payload is never carried by `AuditEntry`, so it cannot leak
 * (Req 10.2, 10.4, 10.5).
 */
export function OperationsCard({ section }: { section: SettledSection<OperationalMetrics> }) {
  return (
    <SectionCard title="Operations" description="Recent webhooks & audit activity" section={section}>
      {(operations) => (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Webhook events</p>
            {operations.recentWebhookEvents.length === 0 ? (
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
              <ul className="flex flex-col divide-y divide-border">
                {operations.recentWebhookEvents.map((event, index) => (
                  <li key={index} className="flex items-center justify-between gap-4 py-2">
                    <span className="truncate text-sm text-foreground">{event.type}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatAdminDateTime(event.processedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Audit log</p>
            {operations.recentAuditEntries.length === 0 ? (
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
              <ul className="flex flex-col divide-y divide-border">
                {operations.recentAuditEntries.map((entry, index) => (
                  <li key={index} className="flex items-center justify-between gap-4 py-2">
                    <span className="truncate text-sm text-foreground">{entry.action}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatAdminDateTime(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  )
}
