"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { TOPIC_LABELS } from "@/lib/domain"
import type { TopicBreakdown } from "@/lib/db/analytics"
import { RESULT_COLORS } from "./topic-colors"
import { PieChart as PieIcon } from "lucide-react"

export function TopicBreakdownChart({ data }: { data: TopicBreakdown[] }) {
  const hasData = data.some((d) => d.correct + d.wrong + d.skipped > 0)
  if (!hasData) {
    return (
      <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <PieIcon className="size-6 text-muted-foreground/60" />
        No answered questions yet.
      </div>
    )
  }

  // Short labels keep the vertical axis readable.
  const rows = data.map((d) => ({
    ...d,
    label: TOPIC_LABELS[d.topic].replace("Fractions, Decimals & Percentages", "Fractions/Dec/%"),
  }))

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
        <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={108}
          tick={{ fontSize: 10 }}
          stroke="hsl(var(--muted-foreground))"
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="correct" stackId="a" name="Correct" fill={RESULT_COLORS.correct} radius={[4, 0, 0, 4]} />
        <Bar dataKey="wrong" stackId="a" name="Wrong" fill={RESULT_COLORS.wrong} />
        <Bar dataKey="skipped" stackId="a" name="Skipped" fill={RESULT_COLORS.skipped} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
