import Link from "next/link"
import Image from "next/image"
import {
  Clock,
  Sparkles,
  LineChart,
  ShieldCheck,
  Calculator,
  Percent,
  Shapes,
  Ratio,
  Sigma,
  BarChart3,
  Check,
  Target,
  TrendingUp,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:gap-12 lg:py-24">
        <div className="flex flex-col items-start gap-6">
          <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
            <Sparkles className="size-3.5 text-primary" />
            AI tutoring, without the £30/hour price tag
          </Badge>
          <h1 className="text-balance font-heading text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Give your child a fair shot at the <span className="text-primary">11+ maths</span> exam
          </h1>
          <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
            Timed, exam-style practice with an AI tutor that explains how — never just the answer — plus clear
            topic-by-topic progress. All for £19.99/month, after a 7-day free trial.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/sign-up">Start your 7-day free trial</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#how-it-works">See how it works</Link>
            </Button>
          </div>
          <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-3">
            <Stat value="£19.99" label="per month" />
            <Stat value="7 days" label="free trial" />
            <Stat value="6 topics" label="full curriculum coverage" />
          </dl>
        </div>
        <div className="relative">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <Image
              src="/hero-child-maths.png"
              alt="A child practising 11+ maths on a tablet at home with a parent nearby"
              width={1024}
              height={1024}
              priority
              className="aspect-[4/3] h-auto w-full object-cover"
            />
          </div>
          <Card className="absolute -bottom-5 left-4 w-56 border-border shadow-lg sm:left-6">
            <CardContent className="flex items-center gap-3 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <LineChart className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Fractions mastery</p>
                <p className="text-xs text-muted-foreground">Up 18% this week</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="font-heading text-2xl font-bold tabular-nums text-foreground">{value}</dt>
      <dd className="text-sm text-muted-foreground">{label}</dd>
    </div>
  )
}

export function ValueProp() {
  return (
    <section className="border-y border-border bg-card">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-3">
        <ValueCard
          stat="£30+/hr"
          title="Private tutoring is expensive"
          body="Traditional 11+ tutors charge £30–£50 an hour, putting structured preparation out of reach for many families."
        />
        <ValueCard
          stat="Hours"
          title="Tracking progress by hand is hard"
          body="Marking worksheets and spotting weak topics manually is slow and easy to get wrong — so children practise the wrong things."
        />
        <ValueCard
          stat="£19.99"
          title="A fraction of the cost of a tutor"
          body="ApexMaths gives your child structured, exam-style preparation for less than the price of a single tutoring hour — making good preparation accessible to more families."
          highlight
        />
      </div>
    </section>
  )
}

function ValueCard({
  stat,
  title,
  body,
  highlight,
}: {
  stat: string
  title: string
  body: string
  highlight?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className={`font-heading text-3xl font-bold tabular-nums ${highlight ? "text-accent" : "text-primary"}`}>
        {stat}
      </span>
      <h3 className="font-heading text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}

const sessionTypes = [
  {
    icon: Sparkles,
    name: "Warm-up",
    detail: "10 questions · mixed topics · 10 minutes",
    body: "A quick, confidence-building mix to get into exam mode.",
  },
  {
    icon: Calculator,
    name: "Practice a topic",
    detail: "5 questions · one topic · 10 minutes",
    body: "Focus on a single curriculum area that needs work.",
  },
  {
    icon: Clock,
    name: "Full mock",
    detail: "30 questions · mixed topics · 50 minutes",
    body: "A realistic, timed rehearsal under true exam conditions.",
  },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <SectionHeading
          eyebrow="How it works"
          title="Three ways to practise, built like the real exam"
          subtitle="Every session is timed and server-enforced, so practice mirrors the pressure of the real 11+."
        />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {sessionTypes.map((s) => (
            <Card key={s.name} className="border-border transition-shadow hover:shadow-md">
              <CardContent className="flex flex-col gap-3 p-6">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <s.icon className="size-5" />
                </span>
                <h3 className="font-heading text-lg font-semibold text-foreground">{s.name}</h3>
                <p className="text-sm font-medium tabular-nums text-accent">{s.detail}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---- Killer feature: per-child, per-topic progress dashboard ----

const demoTopics = [
  { label: "Number", score: 88, tone: "strong" as const },
  { label: "Fractions, Decimals & %", score: 72, tone: "developing" as const },
  { label: "Ratio & Proportion", score: 64, tone: "developing" as const },
  { label: "Algebra", score: 41, tone: "needs_focus" as const },
  { label: "Geometry", score: 79, tone: "strong" as const },
  { label: "Data Handling", score: 83, tone: "strong" as const },
]

const toneStyles: Record<
  "strong" | "developing" | "needs_focus",
  { bar: string; badge: string; label: string }
> = {
  strong: { bar: "bg-success", badge: "bg-success/15 text-success", label: "Strong" },
  developing: { bar: "bg-primary", badge: "bg-primary/10 text-primary", label: "Developing" },
  needs_focus: { bar: "bg-destructive", badge: "bg-destructive/10 text-destructive", label: "Needs focus" },
}

export function ProgressShowcase() {
  return (
    <section id="progress" className="scroll-mt-20 border-y border-border bg-card">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
        <div className="flex flex-col items-start gap-5">
          <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
            <Target className="size-3.5 text-accent" />
            The progress dashboard
          </Badge>
          <h2 className="text-balance font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            See exactly where each child is <span className="text-primary">strong</span> — and what needs work
          </h2>
          <p className="text-pretty leading-relaxed text-muted-foreground">
            Every answer feeds a live mastery score for all six curriculum topics, per child. ApexMaths automatically flags
            the topics that need attention, so you always know what to practise next — no marking, no guesswork.
          </p>
          <ul className="flex flex-col gap-3">
            {[
              "A mastery score for all six topics, updated after every session",
              "Each topic marked Strong, Developing, or Needs focus at a glance",
              "An automatic “focus next” nudge on the weakest topic",
              "Separate progress for each of your children",
            ].map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm text-foreground">
                <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <Button asChild size="lg" className="mt-1">
            <Link href="/sign-up">Track your child's progress</Link>
          </Button>
        </div>

        <Card className="border-border shadow-lg">
          <CardContent className="flex flex-col gap-5 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-accent/15 font-heading text-sm font-bold text-accent">
                  AM
                </span>
                <div>
                  <p className="font-heading text-sm font-semibold text-foreground">Amara</p>
                  <p className="text-xs text-muted-foreground">Year 5</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-heading text-2xl font-bold tabular-nums text-foreground">71%</p>
                <p className="text-xs text-muted-foreground">overall mastery</p>
              </div>
            </div>

            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">Focus next: Algebra</p>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                This is Amara's weakest topic right now. A short practice session here will lift her score the fastest.
              </p>
            </div>

            <div className="flex flex-col gap-3.5" aria-label="Topic mastery breakdown">
              {demoTopics.map((t) => {
                const s = toneStyles[t.tone]
                return (
                  <div key={t.label} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{t.label}</span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.badge}`}
                        >
                          {s.label}
                        </span>
                        <span className="w-9 text-right text-sm font-semibold tabular-nums text-foreground">
                          {t.score}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${t.score}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
              <TrendingUp className="size-4 text-accent" />
              <span>Fractions up 18% over the last 3 sessions</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

const features = [
  {
    icon: Sparkles,
    title: "“Show me how” AI tutor",
    body: "Stuck on a question? Your child gets a clear, step-by-step explanation of the method — and it never reveals the answer.",
  },
  {
    icon: LineChart,
    title: "Topic-level progress",
    body: "See mastery scores across all six curriculum topics, with each marked strong, developing, or needs focus.",
  },
  {
    icon: Clock,
    title: "True exam conditions",
    body: "A server-authoritative timer keeps every session honest, so practice builds real exam-day stamina.",
  },
  {
    icon: ShieldCheck,
    title: "Private & GDPR-first",
    body: "Children's names are never sent to the AI. Export or delete your data at any time, with one click.",
  },
]

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 border-y border-border bg-card">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <SectionHeading
          eyebrow="Features"
          title="Everything a focused 11+ plan needs"
          subtitle="Designed with parents for authority and children for friendliness — all in one calm, distraction-free app."
        />
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="flex gap-4 rounded-xl border border-border bg-background p-6">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                <f.icon className="size-5" />
              </span>
              <div>
                <h3 className="font-heading text-lg font-semibold text-foreground">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
        <TopicStrip />
      </div>
    </section>
  )
}

const topics = [
  { icon: Sigma, label: "Number" },
  { icon: Percent, label: "Fractions, Decimals & %" },
  { icon: Ratio, label: "Ratio & Proportion" },
  { icon: Calculator, label: "Algebra" },
  { icon: Shapes, label: "Geometry" },
  { icon: BarChart3, label: "Data Handling" },
]

function TopicStrip() {
  return (
    <div className="mt-12">
      <p className="text-center text-sm font-medium text-muted-foreground">Full coverage of the 11+ maths curriculum</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        {topics.map((t) => (
          <span
            key={t.label}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground"
          >
            <t.icon className="size-4 text-primary" />
            {t.label}
          </span>
        ))}
      </div>
    </div>
  )
}

const planFeatures = [
  "Unlimited timed practice sessions",
  "Up to 3 child profiles per account",
  "“Show me how” AI tutoring during practice",
  "Personalised AI review after every session",
  "Topic-level progress tracking",
  "Cancel anytime — keep access until period end",
]

export function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-20">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <SectionHeading
          eyebrow="Pricing"
          title="One simple price. No upsells."
          subtitle="We charge only to cover the cost of running the platform — not to profit from your child's education."
        />
        <div className="mx-auto mt-10 max-w-md">
          <Card className="border-border shadow-sm">
            <CardContent className="p-8">
              <div className="flex items-baseline gap-1">
                <span className="font-heading text-5xl font-bold tabular-nums text-foreground">£19.99</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">7-day free trial · then £19.99/month · cancel anytime</p>
              <Button asChild size="lg" className="mt-6 w-full">
                <Link href="/sign-up">Start your free trial</Link>
              </Button>
              <ul className="mt-6 space-y-3">
                {planFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm text-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Card required to start the trial. You won't be charged until day 8.
          </p>
        </div>
      </div>
    </section>
  )
}

export function FinalCta() {
  return (
    <section className="border-t border-border bg-primary">
      <div className="mx-auto w-full max-w-4xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-balance font-heading text-3xl font-bold tracking-tight text-primary-foreground sm:text-4xl">
          Affordable 11+ preparation your child deserves
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-primary-foreground/90">
          Join UK families using ApexMaths to prepare with confidence — for less than the price of a single tutoring hour
          per month.
        </p>
        <Button asChild size="lg" variant="secondary" className="mt-8">
          <Link href="/sign-up">Start your 7-day free trial</Link>
        </Button>
      </div>
    </section>
  )
}

function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string
  title: string
  subtitle: string
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>
      <h2 className="mt-2 text-balance font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">{subtitle}</p>
    </div>
  )
}
