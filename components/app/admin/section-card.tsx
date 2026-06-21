import type { ReactNode } from "react"
import { AlertCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { SettledSection } from "@/lib/db/admin-metrics"

/**
 * Shared wrapper for every admin metric card. Renders a title (and optional
 * description), then either the section body (when the section loaded) or an
 * inline error indicator (when the section failed). Because a failed section
 * renders its own error chip instead of throwing, one failed query never blanks
 * the rest of the page (Req 14.3).
 *
 * The body is provided as a render prop that only runs on the `ok` branch, so
 * card implementations never have to reach into a `SettledSection` themselves.
 */
export function SectionCard<T>({
  title,
  description,
  section,
  children,
}: {
  title: string
  description?: string
  section: SettledSection<T>
  children: (data: T) => ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-heading text-base font-semibold text-foreground">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {section.ok ? (
          children(section.data)
        ) : (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            <AlertCircle className="size-4 shrink-0" />
            <span>Couldn&apos;t load this section</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** A simple label/value row used across the metric cards for aggregate stats. */
export function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-heading text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

/** A prominent headline figure (e.g. total revenue) with a caption beneath it. */
export function StatHero({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-heading text-3xl font-bold tabular-nums text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}
