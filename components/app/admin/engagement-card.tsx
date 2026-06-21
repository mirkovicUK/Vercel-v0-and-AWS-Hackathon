import { SESSION_STATUSES } from "@/lib/domain"
import type { SessionStatus } from "@/lib/domain"
import type { EngagementMetrics, SettledSection } from "@/lib/db/admin-metrics"
import { SectionCard, StatRow } from "@/components/app/admin/section-card"

const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  active: "Active",
  completed: "Completed",
  expired: "Expired",
  abandoned: "Abandoned",
}

/**
 * Engagement metrics: total sessions, sessions by status (all four present),
 * sessions in the trailing 30 days, total AI hint usage, and review reports by
 * generator (nova / fallback) (Req 8.1–8.5).
 */
export function EngagementCard({ section }: { section: SettledSection<EngagementMetrics> }) {
  return (
    <SectionCard title="Engagement" description="Practice activity" section={section}>
      {(engagement) => (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col divide-y divide-border">
            <StatRow label="Total sessions" value={engagement.totalSessions} />
            <StatRow label="Sessions (30d)" value={engagement.sessions30d} />
            <StatRow label="AI hints used" value={engagement.totalHelpUsed} />
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sessions by status</p>
            <div className="flex flex-col divide-y divide-border">
              {SESSION_STATUSES.map((status) => (
                <StatRow key={status} label={SESSION_STATUS_LABELS[status]} value={engagement.byStatus[status]} />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Review reports</p>
            <div className="flex flex-col divide-y divide-border">
              <StatRow label="Nova" value={engagement.reviewReportsByGenerator.nova} />
              <StatRow label="Fallback" value={engagement.reviewReportsByGenerator.fallback} />
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
