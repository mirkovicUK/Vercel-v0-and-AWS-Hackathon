import { Activity } from "lucide-react"
import { SESSION_STATUSES } from "@/lib/domain"
import type { SessionStatus } from "@/lib/domain"
import type { EngagementMetrics, SettledSection } from "@/lib/db/admin-metrics"
import { MetricSection, StatChip, StatGrid, StatTile, SubHeading } from "@/components/app/admin/metric-section"

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
    <MetricSection
      id="engagement"
      title="Engagement"
      description="Practice activity"
      icon={<Activity className="size-5" />}
      accent="steel"
      hasError={!section.ok}
      preview={
        section.ok ? (
          <>
            {section.data.totalSessions}
            <span className="ml-1 text-xs font-normal text-muted-foreground">sessions</span>
          </>
        ) : null
      }
    >
      {section.ok ? (
        <div className="flex flex-col gap-4">
          <StatGrid cols={3}>
            <StatTile label="Total sessions" value={section.data.totalSessions} accent="steel" />
            <StatTile label="Sessions (30d)" value={section.data.sessions30d} />
            <StatTile label="AI hints used" value={section.data.totalHelpUsed} accent="amber" />
          </StatGrid>

          <div>
            <SubHeading>Sessions by status</SubHeading>
            <StatGrid cols={2}>
              {SESSION_STATUSES.map((status) => (
                <StatChip key={status} label={SESSION_STATUS_LABELS[status]} value={section.data.byStatus[status]} />
              ))}
            </StatGrid>
          </div>

          <div>
            <SubHeading>Review reports</SubHeading>
            <StatGrid cols={2}>
              <StatChip label="Nova (AI)" value={section.data.reviewReportsByGenerator.nova} />
              <StatChip label="Fallback" value={section.data.reviewReportsByGenerator.fallback} />
            </StatGrid>
          </div>
        </div>
      ) : null}
    </MetricSection>
  )
}
