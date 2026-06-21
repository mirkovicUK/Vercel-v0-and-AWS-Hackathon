import { TOPICS, TOPIC_LABELS } from "@/lib/domain"
import type { ContentMetrics, SettledSection } from "@/lib/db/admin-metrics"
import { SectionCard, StatRow } from "@/components/app/admin/section-card"

/**
 * Content metrics: total / active / inactive question counts and counts by topic
 * (all topics present, 0 when absent). No answer-bearing data (`text`, `options`,
 * `correct_index`) is shown — only aggregate counts (Req 9.1–9.3).
 */
export function ContentCard({ section }: { section: SettledSection<ContentMetrics> }) {
  return (
    <SectionCard title="Content" description="Question bank" section={section}>
      {(content) => (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col divide-y divide-border">
            <StatRow label="Total questions" value={content.totalQuestions} />
            <StatRow label="Active" value={content.activeQuestions} />
            <StatRow label="Inactive" value={content.inactiveQuestions} />
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">By topic</p>
            <div className="flex flex-col divide-y divide-border">
              {TOPICS.map((topic) => (
                <StatRow key={topic} label={TOPIC_LABELS[topic]} value={content.byTopic[topic]} />
              ))}
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
