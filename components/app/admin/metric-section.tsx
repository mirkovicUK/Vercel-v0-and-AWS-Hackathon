"use client"

import type { ReactNode } from "react"
import { AlertCircle } from "lucide-react"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion"
import { cn } from "@/lib/utils"

/**
 * Presentational, client-side collapsible shell for the admin dashboard.
 *
 * Each metric "card" is a server component that renders its own body and passes
 * it here as plain `children` (a ReactNode) — never a render-prop function — so
 * nothing un-serializable crosses the server→client boundary. This component
 * owns only the open/close interaction and the colour-coded chrome; the
 * server components own the data and PII discipline.
 */

export type AccentColor = "emerald" | "blue" | "amber" | "rose" | "steel" | "slate"

const ACCENT: Record<AccentColor, { chip: string; value: string }> = {
  emerald: { chip: "bg-success/10 text-success ring-1 ring-inset ring-success/20", value: "text-success" },
  blue: { chip: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20", value: "text-primary" },
  amber: { chip: "bg-accent/20 text-accent-foreground ring-1 ring-inset ring-accent/40", value: "text-foreground" },
  rose: { chip: "bg-chart-4/10 text-chart-4 ring-1 ring-inset ring-chart-4/20", value: "text-chart-4" },
  steel: { chip: "bg-chart-5/10 text-chart-5 ring-1 ring-inset ring-chart-5/20", value: "text-chart-5" },
  slate: { chip: "bg-muted text-muted-foreground ring-1 ring-inset ring-border", value: "text-foreground" },
}

/** The accordion root. Sections are independently collapsible (`type="multiple"`). */
export function MetricAccordion({
  children,
  defaultValue,
}: {
  children: ReactNode
  defaultValue?: string[]
}) {
  return (
    <Accordion type="multiple" defaultValue={defaultValue} className="flex flex-col gap-3">
      {children}
    </Accordion>
  )
}

/** One collapsible metric section: colour-coded header (always visible) + body (on expand). */
export function MetricSection({
  id,
  title,
  description,
  icon,
  accent,
  preview,
  hasError,
  children,
}: {
  id: string
  title: string
  description?: string
  icon: ReactNode
  accent: AccentColor
  preview?: ReactNode
  hasError?: boolean
  children: ReactNode
}) {
  const a = ACCENT[accent]
  return (
    <AccordionItem
      value={id}
      className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md data-[state=open]:shadow-md"
    >
      <AccordionTrigger className="items-center px-4 py-4 hover:no-underline sm:px-5">
        <span className="flex flex-1 items-center gap-3 sm:gap-4">
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", a.chip)}>{icon}</span>
          <span className="flex flex-col gap-0.5 text-left">
            <span className="font-heading text-base font-semibold text-foreground">{title}</span>
            {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
          </span>
          <span className="ml-auto pr-1 text-right">
            {hasError ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                <AlertCircle className="size-3.5" />
                Error
              </span>
            ) : preview != null ? (
              <span className={cn("font-heading text-lg font-bold tabular-nums sm:text-xl", a.value)}>{preview}</span>
            ) : null}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-5 sm:px-5">
        {hasError ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            <AlertCircle className="size-4 shrink-0" />
            <span>Couldn&apos;t load this section</span>
          </div>
        ) : (
          children
        )}
      </AccordionContent>
    </AccordionItem>
  )
}

/** A prominent accent-coloured headline figure with a caption beneath it. */
export function StatHero({
  label,
  value,
  accent = "blue",
}: {
  label: string
  value: ReactNode
  accent?: AccentColor
}) {
  return (
    <div className="flex flex-col">
      <span className={cn("font-heading text-3xl font-bold tracking-tight tabular-nums", ACCENT[accent].value)}>
        {value}
      </span>
      <span className="mt-0.5 text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

/** Responsive grid wrapper for stat tiles / chips. */
export function StatGrid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return (
    <div className={cn("grid gap-2.5", cols === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>{children}</div>
  )
}

/** A boxed stat: large number with a label beneath. Optional accent + highlight. */
export function StatTile({
  label,
  value,
  accent,
  highlight,
}: {
  label: string
  value: ReactNode
  accent?: AccentColor
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        highlight ? "border-accent/40 bg-accent/10" : "border-border bg-secondary/40",
      )}
    >
      <div
        className={cn(
          "font-heading text-2xl font-bold tabular-nums",
          accent ? ACCENT[accent].value : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

/** A compact label/value chip for dense breakdowns (statuses, topics). */
export function StatChip({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className="font-heading text-sm font-bold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

/** A small uppercase sub-heading used to group breakdowns within a section body. */
export function SubHeading({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</p>
}

/** A label/value row for simple two-column lists. */
export function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-heading text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}
