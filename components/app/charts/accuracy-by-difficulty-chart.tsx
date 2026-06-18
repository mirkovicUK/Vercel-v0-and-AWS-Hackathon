"use client"

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts"
import type { DifficultyAccuracy } from "@/lib/db/analytics"
import { Layers } from "lucide-react"

// Green→amber→red by accuracy so weak difficulty bands pop.
function barColor(pct: number): string {
  if (pct >= 80) return "#10b981"
  if (pct >= 50) return "#f59e0b"
  return "#ef4444"
}

export function AccuracyByDifficultyChart({ data }: { data: DifficultyAccuracy[] }) {
  const hasData = data.some((d) => d.attempts > 0)
  if (!hasData) {
    return (
      <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <Layers className="size-6 text-muted-foreground/60" />
        No graded answers yet.
      </div>
    )
  }

  const rows = data.map((d) => ({ ...d, label: `Level ${d.difficulty}` }))

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 12 }}
          formatter={(value: number, _name, item) => {
            const d = item?.payload as DifficultyAccuracy
            return [`${value}% (${d.correct}/${d.attempts})`, "Accuracy"]
          }}
        />
        <Bar dataKey="pct" radius={[6, 6, 0, 0]} maxBarSize={56}>
          {rows.map((r) => (
            <Cell key={r.difficulty} fill={barColor(r.pct)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
