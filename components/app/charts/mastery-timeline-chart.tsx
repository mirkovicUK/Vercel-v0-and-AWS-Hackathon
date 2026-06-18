"use client"

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { TOPICS, TOPIC_LABELS, type Topic } from "@/lib/domain"
import { TOPIC_COLORS } from "./topic-colors"
import type { MasteryTimelinePoint } from "@/lib/db/analytics"
import { TrendingUp } from "lucide-react"

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

export function MasteryTimelineChart({ points }: { points: MasteryTimelinePoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <TrendingUp className="size-6 text-muted-foreground/60" />
        Complete a few more sessions to see mastery trend over time.
      </div>
    )
  }

  const data = points.map((p) => ({ label: shortDate(p.date), ...p.values }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 12 }}
          formatter={(value: number, name: string) => [`${value}%`, name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
        {TOPICS.map((topic: Topic) => (
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
  )
}
