import { Users } from "lucide-react"
import type { SettledSection, UserMetrics } from "@/lib/db/admin-metrics"
import { MetricSection, StatGrid, StatTile } from "@/components/app/admin/metric-section"

/**
 * User metrics: active parents, soft-deleted accounts, new signups in the
 * trailing 30 days, and active children. No Child_PII is shown — only the
 * aggregate child count (Req 7.1–7.4, 7.5).
 */
export function UsersCard({ section }: { section: SettledSection<UserMetrics> }) {
  return (
    <MetricSection
      id="users"
      title="Users"
      description="Parent & child accounts"
      icon={<Users className="size-5" />}
      accent="rose"
      hasError={!section.ok}
      preview={
        section.ok ? (
          <>
            {section.data.activeParents}
            <span className="ml-1 text-xs font-normal text-muted-foreground">parents</span>
          </>
        ) : null
      }
    >
      {section.ok ? (
        <StatGrid>
          <StatTile label="Active parents" value={section.data.activeParents} accent="rose" />
          <StatTile label="Active children" value={section.data.activeChildren} accent="rose" />
          <StatTile label="New parents (30d)" value={section.data.newParents30d} />
          <StatTile label="Soft-deleted parents" value={section.data.deletedParents} />
        </StatGrid>
      ) : null}
    </MetricSection>
  )
}
