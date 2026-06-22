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
  Brain,
  TrendingUp,
  FileText,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { DashboardCarousel } from "@/components/marketing/dashboard-carousel"

export function Hero({ authed = false }: { authed?: boolean }) {
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
            Timed, exam-style practice with an AI tutor that explains how — never just the answer. Our adaptive
            <span className="font-medium text-foreground"> Skill builder</span> tailors every session to your child,
            quietly targeting their weakest topics over time — plus clear topic-by-topic progress for you. All for
            £19.99/month, after a 7-day free trial.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href={authed ? "/dashboard" : "/sign-up"}>
                {authed ? "Go to dashboard" : "Start your 7-day free trial"}
              </Link>
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
    icon: Brain,
    name: "Skill builder",
    detail: "15 questions · adapts to your child · 20 minutes",
    body: "A unique mix built from your child's own results — more questions on their weakest topics, pitched at the right level, so they improve where it matters most.",
    badge: "Adaptive",
  },
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
          title="Four ways to practise — one adapts to your child"
          subtitle="Every session is timed and server-enforced, so practice mirrors the pressure of the real 11+. The adaptive Skill builder goes further: it learns from each child's results and targets their weak spots over time."
        />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {sessionTypes.map((s) => (
            <Card
              key={s.name}
              className={`border-border transition-shadow hover:shadow-md ${s.badge ? "ring-1 ring-primary/30" : ""}`}
            >
              <CardContent className="flex flex-col gap-3 p-6">
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <s.icon className="size-5" />
                  </span>
                  {s.badge ? (
                    <Badge variant="secondary" className="gap-1 text-xs font-medium">
                      <Target className="size-3 text-primary" />
                      {s.badge}
                    </Badge>
                  ) : null}
                </div>
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

export function ProgressShowcase({ authed = false }: { authed?: boolean }) {
  return (
    <section id="progress" className="scroll-mt-20 overflow-x-clip border-y border-border bg-card">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
        <div className="flex min-w-0 flex-col items-start gap-5">
          <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
            <Target className="size-3.5 text-accent" />
            The progress dashboard
          </Badge>
          <h2 className="text-balance font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            See exactly where each child is <span className="text-primary">strong</span> — and what needs work
          </h2>
          <p className="text-pretty leading-relaxed text-muted-foreground">
            Every answer feeds a live mastery score for all six curriculum topics, per child. ApexMaths automatically flags
            the topics that need attention — and turns it into a written AI progress report, generated on demand from that
            child's own data in the moment. No marking, no guesswork.
          </p>
          <ul className="flex flex-col gap-3">
            {[
              "A mastery score for all six topics, updated after every session",
              "Each topic marked Strong, Developing, or Needs focus at a glance",
              "An on-demand AI review report, written fresh for each child from their latest results",
              "An automatic “focus next” nudge on the weakest topic",
              "Separate progress and reports for each of your children",
            ].map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm text-foreground">
                <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <Button asChild size="lg" className="mt-1">
            <Link href={authed ? "/dashboard" : "/sign-up"}>
              {authed ? "Go to dashboard" : "Track your child's progress"}
            </Link>
          </Button>
        </div>

        <DashboardCarousel />
      </div>
    </section>
  )
}

const features = [
  {
    icon: Brain,
    title: "Adaptive Skill builder",
    body: "Builds a unique session for each child from their own results — weighting more questions onto their weakest topics and pitching the difficulty just right, so they improve where it matters, session after session.",
  },
  {
    icon: FileText,
    title: "AI review report, per child",
    body: "A written progress report generated on demand for each child from their data in that moment — strengths, the topics to focus on, and concrete next steps for the week.",
  },
  {
    icon: Sparkles,
    title: "“Show me how” AI tutor",
    body: "Stuck on a question? Your child gets a clear, step-by-step explanation of the method — and it never reveals the answer.",
  },
  {
    icon: TrendingUp,
    title: "Improves over time",
    body: "Every answer sharpens the picture, so each adaptive session targets your child's current weak spots — steady, compounding progress instead of random practice.",
  },
  {
    icon: LineChart,
    title: "Topic-level progress",
    body: "See mastery scores across all six curriculum topics, with each marked strong, developing, or needs focus.",
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
  "Adaptive “Skill builder” sessions tailored to each child",
  "Up to 3 child profiles per account",
  "“Show me how” AI tutoring during practice",
  "Personalised AI review after every session",
  "On-demand AI progress report for each child",
  "Topic-level progress tracking",
  "Cancel anytime — keep access until period end",
]

export function Pricing({ authed = false }: { authed?: boolean }) {
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
                <Link href={authed ? "/dashboard" : "/sign-up"}>
                  {authed ? "Go to dashboard" : "Start your free trial"}
                </Link>
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

export function FinalCta({ authed = false }: { authed?: boolean }) {
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
          <Link href={authed ? "/dashboard" : "/sign-up"}>
            {authed ? "Go to dashboard" : "Start your 7-day free trial"}
          </Link>
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
