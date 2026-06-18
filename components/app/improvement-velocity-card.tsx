"use client"

import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts"
import type { ImprovementVelocity } from "@/lib/db/analytics"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"

export function ImprovementVelocityCard({ velocity }: { velocity: ImprovementVelocity }) {
  const { current, lastDelta, series } = velocity
  const up = lastDelta != null && lastDelta > 0
  const down = lastDelta != null && lastDelta < 0
  const sparkData = series.map((p, i) => ({ i, v: p.cumulativePct }))

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">Overall mastery</p>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
            up && "bg-success/15 text-success",
            down && "bg-destructive/10 text-destructive",
            !up && !down && "bg-muted text-muted-foreground",
          )}
        >
          {up ? <TrendingUp className="size-3.5" /> : down ? <TrendingDown className="size-3.5" /> : <Minus className="size-3.5" />}
          {lastDelta == null ? "—" : `${lastDelta > 0 ? "+" : ""}${lastDelta} pts`}
        </span>
      </div>

      <div className="mt-1 flex items-end gap-2">
        <span className="font-heading text-4xl font-bold tabular-nums text-foreground">{current}%</span>
        <span className="mb-1 text-xs text-muted-foreground">vs last session</span>
      </div>

      <div className="mt-3 h-12">
        {sparkData.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
              <YAxis domain={[0, 100]} hide />
              <Line
                type="monotone"
                dataKey="v"
                stroke={down ? "#ef4444" : "#10b981"}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-muted-foreground">Trend appears after two sessions.</p>
        )}
      </div>
    </div>
  )
}
