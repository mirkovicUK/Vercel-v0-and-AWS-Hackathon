import type { SettledSection, UserMetrics } from "@/lib/db/admin-metrics"
import { SectionCard, StatRow } from "@/components/app/admin/section-card"

/**
 * User metrics: active parents, soft-deleted accounts, new signups in the
 * trailing 30 days, and active children. No Child_PII is shown — only the
 * aggregate child count (Req 7.1–7.4, 7.5).
 */
export function UsersCard({ section }: { section: SettledSection<UserMetrics> }) {
  return (
    <SectionCard title="Users" description="Parent & child accounts" section={section}>
      {(users) => (
        <div className="flex flex-col divide-y divide-border">
          <StatRow label="Active parents" value={users.activeParents} />
          <StatRow label="Soft-deleted parents" value={users.deletedParents} />
          <StatRow label="New parents (30d)" value={users.newParents30d} />
          <StatRow label="Active children" value={users.activeChildren} />
        </div>
      )}
    </SectionCard>
  )
}
