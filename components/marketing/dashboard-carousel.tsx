"use client"

import { useEffect, useState } from "react"
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "@/components/ui/carousel"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { MasteryTimelineChart } from "@/components/app/charts/mastery-timeline-chart"
import { AccuracyByDifficultyChart } from "@/components/app/charts/accuracy-by-difficulty-chart"
import { TopicBreakdownChart } from "@/components/app/charts/topic-breakdown-chart"
import { TopicMasteryList } from "@/components/app/topic-mastery-list"
import type { MasteryTimelinePoint, DifficultyAccuracy, TopicBreakdown } from "@/lib/db/analytics"
import type { TopicProgress } from "@/lib/domain"
import { TrendingUp, Layers, BarChart3, ListChecks, CheckCircle2, History } from "lucide-react"

/* ---- Demo data (illustrative only — the real dashboard uses live Aurora queries) ---- */

const TIMELINE: MasteryTimelinePoint[] = [
  { date: "2026-04-20", values: { number: 58, fractions_decimals_percentages: 44, ratio_proportion: 40, algebra: 22, geometry: 55, data_handling: 60 } },
  { date: "2026-04-27", values: { number: 66, fractions_decimals_percentages: 52, ratio_proportion: 48, algebra: 28, geometry: 62, data_handling: 66 } },
  { date: "2026-05-03", values: { number: 74, fractions_decimals_percentages: 60, ratio_proportion: 55, algebra: 33, geometry: 70, data_handling: 73 } },
  { date: "2026-05-10", values: { number: 81, fractions_decimals_percentages: 67, ratio_proportion: 60, algebra: 37, geometry: 75, data_handling: 79 } },
  { date: "2026-05-17", values: { number: 88, fractions_decimals_percentages: 72, ratio_proportion: 64, algebra: 41, geometry: 79, data_handling: 83 } },
]

const DIFFICULTY: DifficultyAccuracy[] = [
  { difficulty: 1, attempts: 24, correct: 23, pct: 96 },
  { difficulty: 2, attempts: 26, correct: 23, pct: 88 },
  { difficulty: 3, attempts: 22, correct: 16, pct: 73 },
  { difficulty: 4, attempts: 18, correct: 9, pct: 50 },
  { difficulty: 5, attempts: 12, correct: 4, pct: 33 },
]

const BREAKDOWN: TopicBreakdown[] = [
  { topic: "number", correct: 42, wrong: 6, skipped: 2 },
  { topic: "fractions_decimals_percentages", correct: 30, wrong: 10, skipped: 3 },
  { topic: "ratio_proportion", correct: 26, wrong: 12, skipped: 4 },
  { topic: "algebra", correct: 14, wrong: 18, skipped: 6 },
  { topic: "geometry", correct: 33, wrong: 7, skipped: 2 },
  { topic: "data_handling", correct: 38, wrong: 6, skipped: 1 },
]

const PROGRESS: TopicProgress[] = [
  { childId: "demo", topic: "number", attempts: 50, correct: 44, masteryScore: 88, classification: "strong", updatedAt: "" },
  { childId: "demo", topic: "fractions_decimals_percentages", attempts: 43, correct: 31, masteryScore: 72, classification: "developing", updatedAt: "" },
  { childId: "demo", topic: "ratio_proportion", attempts: 42, correct: 27, masteryScore: 64, classification: "developing", updatedAt: "" },
  { childId: "demo", topic: "algebra", attempts: 38, correct: 16, masteryScore: 41, classification: "needs_focus", updatedAt: "" },
  { childId: "demo", topic: "geometry", attempts: 42, correct: 33, masteryScore: 79, classification: "developing", updatedAt: "" },
  { childId: "demo", topic: "data_handling", attempts: 45, correct: 38, masteryScore: 83, classification: "strong", updatedAt: "" },
]

const SESSIONS = [
  { label: "Full mock", topic: null as string | null, date: "17 May", score: 27, total: 30, pct: 90 },
  { label: "Practice a topic", topic: "Algebra", date: "15 May", score: 3, total: 5, pct: 60 },
  { label: "Warm-up", topic: null, date: "12 May", score: 8, total: 10, pct: 80 },
  { label: "Practice a topic", topic: "Fractions, Decimals & %", date: "10 May", score: 4, total: 5, pct: 80 },
  { label: "Full mock", topic: null, date: "6 May", score: 22, total: 30, pct: 73 },
]

const SLIDES = [
  { key: "timeline", title: "Mastery over time", icon: TrendingUp, render: () => <MasteryTimelineChart points={TIMELINE} /> },
  { key: "difficulty", title: "Accuracy by difficulty", icon: Layers, render: () => <AccuracyByDifficultyChart data={DIFFICULTY} /> },
  { key: "breakdown", title: "Answers by topic", icon: BarChart3, render: () => <TopicBreakdownChart data={BREAKDOWN} /> },
  { key: "mastery", title: "Mastery by topic", icon: ListChecks, render: () => <TopicMasteryList progress={PROGRESS} /> },
  { key: "sessions", title: "Recent sessions", icon: History, render: () => <DemoSessions /> },
] as const

function DemoSessions() {
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
      {SESSIONS.map((s, i) => (
        <li key={i} className="flex items-center justify-between gap-4 p-3.5">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">
                {s.label}
                {s.topic ? <span className="text-muted-foreground"> · {s.topic}</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">{s.date}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums text-foreground">
              {s.score}/{s.total}
            </p>
            <p className="text-xs text-muted-foreground">{s.pct}%</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function DashboardCarousel() {
  const [api, setApi] = useState<CarouselApi>()
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    if (!api) return
    const onSelect = () => setSelected(api.selectedScrollSnap())
    onSelect()
    api.on("select", onSelect)
    return () => {
      api.off("select", onSelect)
    }
  }, [api])

  // Gentle auto-advance; pauses while the pointer is over the carousel.
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (!api || paused) return
    const id = setInterval(() => api.scrollNext(), 5000)
    return () => clearInterval(id)
  }, [api, paused])

  return (
    <div className="relative" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <Card className="overflow-hidden border-border shadow-lg">
        <CardContent className="p-5 sm:p-6">
          <Carousel setApi={setApi} opts={{ loop: true }}>
            <CarouselContent>
              {SLIDES.map((slide) => (
                <CarouselItem key={slide.key}>
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
                      <slide.icon className="size-4" />
                    </span>
                    <h3 className="font-heading text-sm font-semibold text-foreground">{slide.title}</h3>
                  </div>
                  <div className="mt-4 flex min-h-[300px] items-center">
                    <div className="w-full">{slide.render()}</div>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>

          {/* Dots */}
          <div className="mt-5 flex items-center justify-center gap-2">
            {SLIDES.map((slide, i) => (
              <button
                key={slide.key}
                type="button"
                aria-label={`Show ${slide.title}`}
                onClick={() => api?.scrollTo(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  selected === i ? "w-6 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground/40",
                )}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        Live example — every view is a real Aurora query in the app.
      </p>
    </div>
  )
}
