"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { TOPIC_LABELS, type Topic } from "@/lib/domain"
import { TOPIC_COLORS } from "./topic-colors"
import type { MasteryTimeline, TimelineRange } from "@/lib/db/analytics"
import { TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"

const RANGES: { key: TimelineRange; label: string }[] = [
  { key: "30d", label: "30 days" },
  { key: "3m", label: "3 months" },
  { key: "all", label: "All" },
]

const OVERALL_COLOR = "hsl(var(--primary))"

function fmtDate(iso: string, bucket: MasteryTimeline["bucket"]): string {
  const d = new Date(iso)
  return bucket === "month"
    ? d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

export function MasteryTimelineChart({
  timeline,
  overallPct,
  interactive = true,
  defaultTopics,
}: {
  timeline: MasteryTimeline
  /** Lifetime overall mastery, shown as the headline number. */
  overallPct?: number
  /** When false (marketing demo), the range control is hidden. */
  interactive?: boolean
  /** Topics shown by default (marketing demo passes all; the app defaults to
   *  the overall line only and lets the parent opt topics in). */
  defaultTopics?: Topic[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [shown, setShown] = useState<Set<Topic>>(new Set(defaultTopics ?? []))

  function setRange(r: TimelineRange) {
    const p = new URLSearchParams(searchParams?.toString() ?? "")
    p.set("range", r)
    router.replace(`${pathname}?${p.toString()}`, { scroll: false })
  }

  function toggleTopic(t: Topic) {
    setShown((prev) => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  }

  const hasOverall = timeline.points.some((p) => p.overall != null)

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      {typeof overallPct === "number" ? (
        <p className="text-sm text-muted-foreground">
          Overall mastery <span className="font-semibold text-foreground">{overallPct}%</span>
          <span className="ml-1 text-xs">(lifetime)</span>
        </p>
      ) : (
        <span />
      )}
      {interactive && (
        <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                timeline.range === r.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={timeline.range === r.key}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  if (timeline.points.length < 2) {
    return (
      <div>
        {header}
        <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <TrendingUp className="size-6 text-muted-foreground/60" />
          Complete a few more sessions in this range to see the mastery trend.
        </div>
      </div>
    )
  }

  const data = timeline.points.map((p) => ({
    label: fmtDate(p.date, timeline.bucket),
    overall: p.overall ?? null,
    ...p.values,
  }))

  return (
    <div>
      {header}
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 12 }}
            formatter={(value: number, name: string) => [`${value}%`, name]}
          />
          {hasOverall && (
            <Line
              type="monotone"
              dataKey="overall"
              name="Overall"
              stroke={OVERALL_COLOR}
              strokeWidth={2.5}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
              connectNulls
            />
          )}
          {timeline.topics
            .filter((t) => shown.has(t))
            .map((topic) => (
              <Line
                key={topic}
                type="monotone"
                dataKey={topic}
                name={TOPIC_LABELS[topic]}
                stroke={TOPIC_COLORS[topic]}
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
                connectNulls
              />
            ))}
        </LineChart>
      </ResponsiveContainer>

      {timeline.topics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="self-center text-xs text-muted-foreground">Add a topic:</span>
          {timeline.topics.map((t) => {
            const active = shown.has(t)
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTopic(t)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  active ? "border-transparent text-white" : "border-border text-muted-foreground hover:text-foreground",
                )}
                style={active ? { backgroundColor: TOPIC_COLORS[t] } : undefined}
                aria-pressed={active}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: active ? "white" : TOPIC_COLORS[t] }}
                />
                {TOPIC_LABELS[t]}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
