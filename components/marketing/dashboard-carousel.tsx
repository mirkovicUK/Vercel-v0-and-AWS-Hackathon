"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "@/components/ui/carousel"
import { cn } from "@/lib/utils"
import { MasteryTimelineChart } from "@/components/app/charts/mastery-timeline-chart"
import { AccuracyByDifficultyChart } from "@/components/app/charts/accuracy-by-difficulty-chart"
import { TopicBreakdownChart } from "@/components/app/charts/topic-breakdown-chart"
import { TopicMasteryList } from "@/components/app/topic-mastery-list"
import type { MasteryTimelinePoint, DifficultyAccuracy, TopicBreakdown } from "@/lib/db/analytics"
import type { TopicProgress } from "@/lib/domain"
import { TrendingUp, Layers, BarChart3, ListChecks, CheckCircle2, Clock, ChevronRight, History } from "lucide-react"

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

interface DemoSession {
  label: string
  topic: string | null
  date: string
  score: number
  total: number
  expired?: boolean
}

const SESSIONS: DemoSession[] = [
  { label: "Full mock", topic: null, date: "17 May 2026", score: 27, total: 30 },
  { label: "Practice a topic", topic: "Algebra", date: "15 May 2026", score: 3, total: 5 },
  { label: "Warm-up", topic: null, date: "12 May 2026", score: 8, total: 10 },
  { label: "Full mock", topic: null, date: "8 May 2026", score: 19, total: 30, expired: true },
  { label: "Practice a topic", topic: "Fractions, Decimals & %", date: "6 May 2026", score: 4, total: 5 },
]

function DemoSessions() {
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
      {SESSIONS.map((s, i) => {
        const pct = Math.round((s.score / s.total) * 100)
        return (
          <li key={i} className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                  s.expired ? "bg-muted text-muted-foreground" : "bg-success/15 text-success",
                )}
              >
                {s.expired ? <Clock className="size-4" /> : <CheckCircle2 className="size-4" />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {s.label}
                  {s.topic ? <span className="text-muted-foreground"> · {s.topic}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {s.date}
                  {s.expired ? " · timed out" : ""}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {s.score}/{s.total}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">{pct}%</p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

type RGB = [number, number, number]

const SLIDES = [
  { key: "timeline", title: "Mastery over time", icon: TrendingUp, accent: [46, 115, 184] as RGB, render: () => <MasteryTimelineChart points={TIMELINE} /> },
  { key: "difficulty", title: "Accuracy by difficulty", icon: Layers, accent: [245, 158, 11] as RGB, render: () => <AccuracyByDifficultyChart data={DIFFICULTY} /> },
  { key: "breakdown", title: "Answers by topic", icon: BarChart3, accent: [16, 185, 129] as RGB, render: () => <TopicBreakdownChart data={BREAKDOWN} /> },
  { key: "mastery", title: "Mastery by topic", icon: ListChecks, accent: [139, 92, 246] as RGB, render: () => <TopicMasteryList progress={PROGRESS} /> },
  { key: "sessions", title: "Recent sessions", icon: History, accent: [13, 148, 136] as RGB, render: () => <DemoSessions /> },
] as const

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * Animated, colour-reactive gradient behind the carousel. Two slow floating
 * radial blobs whose colour eases toward the active slide's accent. Respects
 * reduced-motion and pauses when off-screen.
 */
function CarouselGradient({ target }: { target: RGB }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const targetRef = useRef<RGB>(target)
  targetRef.current = target

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    const cur: RGB = [...targetRef.current]
    let raf = 0
    let visible = true

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr)
        canvas.height = Math.floor(h * dpr)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
    }

    const draw = (now: number) => {
      resize()
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      // ease current colour toward the active accent
      for (let i = 0; i < 3; i++) cur[i] += (targetRef.current[i] - cur[i]) * 0.06
      const [r, g, b] = cur.map((v) => Math.round(v))

      ctx.clearRect(0, 0, w, h)
      const t = reduced ? 0 : now * 0.00018
      const cx = w * 0.5
      const cy = h * 0.45
      const a = Math.min(w, h) * 0.4
      const x1 = cx + Math.cos(t) * a
      const y1 = cy + Math.sin(t * 0.8) * a * 0.5
      const x2 = cx + Math.cos(-t * 0.9 + 1.4) * a * 0.8
      const y2 = cy + Math.sin(-t * 0.7 + 0.6) * a * 0.6
      const rad = Math.max(w, h) * 0.8

      const g1 = ctx.createRadialGradient(x1, y1, 0, x1, y1, rad)
      g1.addColorStop(0, `rgba(${r},${g},${b},0.30)`)
      g1.addColorStop(1, `rgba(${r},${g},${b},0)`)
      ctx.fillStyle = g1
      ctx.fillRect(0, 0, w, h)

      const g2 = ctx.createRadialGradient(x2, y2, 0, x2, y2, rad * 0.85)
      g2.addColorStop(0, `rgba(${r},${g},${b},0.18)`)
      g2.addColorStop(1, `rgba(${r},${g},${b},0)`)
      ctx.fillStyle = g2
      ctx.fillRect(0, 0, w, h)

      if (!reduced && visible) raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)

    // Pause when the carousel scrolls out of view.
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true
        if (visible && !reduced && !raf) raf = requestAnimationFrame(draw)
        if (!visible && raf) {
          cancelAnimationFrame(raf)
          raf = 0
        }
      },
      { threshold: 0 },
    )
    io.observe(canvas)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      io.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 -z-10 h-full w-full" />
}

export function DashboardCarousel() {
  const [api, setApi] = useState<CarouselApi>()
  const [selected, setSelected] = useState(0)
  const [paused, setPaused] = useState(false)
  const tweenNodes = useRef<HTMLElement[]>([])

  const setTweenNodes = useCallback((emblaApi: NonNullable<CarouselApi>) => {
    tweenNodes.current = emblaApi.slideNodes().map((node) => node.querySelector(".tween") as HTMLElement)
  }, [])

  // Continuously map each slide's distance from centre → depth (translateZ),
  // tilt (rotateY), scale, blur and z-index, driven by embla's live
  // scrollProgress so the panels glide in 3D rather than snapping on select.
  const tween = useCallback((emblaApi: NonNullable<CarouselApi>) => {
    const engine = emblaApi.internalEngine()
    const scrollProgress = emblaApi.scrollProgress()

    emblaApi.scrollSnapList().forEach((scrollSnap, snapIndex) => {
      let diffToTarget = scrollSnap - scrollProgress
      const slidesInSnap = engine.slideRegistry[snapIndex]

      slidesInSnap.forEach((slideIndex) => {
        if (engine.options.loop) {
          engine.slideLooper.loopPoints.forEach((loopItem) => {
            const target = loopItem.target()
            if (slideIndex === loopItem.index && target !== 0) {
              const sign = Math.sign(target)
              if (sign === -1) diffToTarget = scrollSnap - (1 + scrollProgress)
              if (sign === 1) diffToTarget = scrollSnap + (1 - scrollProgress)
            }
          })
        }
        const node = tweenNodes.current[slideIndex]
        if (!node) return
        const d = clamp(Math.abs(diffToTarget), 0, 1)
        const scale = 1 - d * 0.14 // 1.0 centred → 0.86
        const rotateY = clamp(diffToTarget * -22, -26, 26)
        const translateZ = -d * 170 // recede into depth
        const opacity = 1 - d * 0.4
        const blur = d < 0.06 ? 0 : Math.min(d * 3.2, 3) // active stays crisp
        node.style.transform = `translate3d(0,0,${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`
        node.style.opacity = `${opacity}`
        node.style.filter = blur ? `blur(${blur.toFixed(2)}px)` : "none"
        node.style.zIndex = String(100 - Math.round(d * 50))
        node.style.pointerEvents = d < 0.2 ? "auto" : "none"
      })
    })
  }, [])

  useEffect(() => {
    if (!api) return
    const onSelect = () => setSelected(api.selectedScrollSnap())
    setTweenNodes(api)
    tween(api)
    onSelect()
    api.on("select", onSelect)
    api.on("reInit", () => {
      setTweenNodes(api)
      tween(api)
      onSelect()
    })
    api.on("scroll", () => tween(api))
    return () => {
      api.off("select", onSelect)
    }
  }, [api, tween, setTweenNodes])

  useEffect(() => {
    if (!api || paused) return
    const id = setInterval(() => api.scrollNext(), 3500)
    return () => clearInterval(id)
  }, [api, paused])

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <CarouselGradient target={SLIDES[selected]?.accent ?? SLIDES[0].accent} />

      {/* duration: higher = slower, gliding scroll. loop + center for coverflow. */}
      <Carousel setApi={setApi} opts={{ loop: true, align: "center", duration: 36 }}>
        <CarouselContent className="py-6" style={{ perspective: "1500px" }}>
          {SLIDES.map((slide) => (
            <CarouselItem key={slide.key} className="basis-full">
              <div
                className="tween rounded-2xl border border-border bg-card shadow-xl will-change-transform"
                style={{ transformStyle: "preserve-3d", backfaceVisibility: "hidden" }}
              >
                <div className="p-5 sm:p-6">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
                      <slide.icon className="size-4" />
                    </span>
                    <h3 className="font-heading text-sm font-semibold text-foreground">{slide.title}</h3>
                  </div>
                  <div className="mt-4 min-h-[300px]">{slide.render()}</div>
                </div>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>

      {/* Dots */}
      <div className="mt-2 flex items-center justify-center gap-2">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.key}
            type="button"
            aria-label={`Show ${slide.title}`}
            aria-current={selected === i}
            onClick={() => api?.scrollTo(i)}
            className={cn(
              "h-2 rounded-full transition-all",
              selected === i ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/60",
            )}
          />
        ))}
      </div>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        Live example — every view is a real Aurora query in the app.
      </p>
    </div>
  )
}
