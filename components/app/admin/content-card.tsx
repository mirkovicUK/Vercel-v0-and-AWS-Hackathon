import { Library } from "lucide-react"
import { TOPICS, TOPIC_LABELS } from "@/lib/domain"
import type { ContentMetrics, SettledSection } from "@/lib/db/admin-metrics"
import { MetricSection, StatChip, StatGrid, StatTile, SubHeading } from "@/components/app/admin/metric-section"

/**
 * Content metrics: total / active / inactive question counts and counts by topic
 * (all topics present, 0 when absent). No answer-bearing data (`text`, `options`,
 * `correct_index`) is shown — only aggregate counts (Req 9.1–9.3).
 */
export function ContentCard({ section }: { section: SettledSection<ContentMetrics> }) {
  return (
    <MetricSection
      id="content"
      title="Content"
      description="Question bank"
      icon={<Library className="size-5" />}
      accent="amber"
      hasError={!section.ok}
      preview={
        section.ok ? (
          <>
            {section.data.totalQuestions}
            <span className="ml-1 text-xs font-normal text-muted-foreground">questions</span>
          </>
        ) : null
      }
    >
      {section.ok ? (
        <div className="flex flex-col gap-4">
          <StatGrid cols={3}>
            <StatTile label="Total" value={section.data.totalQuestions} />
            <StatTile label="Active" value={section.data.activeQuestions} accent="emerald" />
            <StatTile label="Inactive" value={section.data.inactiveQuestions} />
          </StatGrid>
          <div>
            <SubHeading>By topic</SubHeading>
            <StatGrid cols={3}>
              {TOPICS.map((topic) => (
                <StatChip key={topic} label={TOPIC_LABELS[topic]} value={section.data.byTopic[topic]} />
              ))}
            </StatGrid>
          </div>
        </div>
      ) : null}
    </MetricSection>
  )
}
