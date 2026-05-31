import { cn } from "@/lib/utils"

const COLOR_MAP: Record<string, string> = {
  teal: "bg-accent/20 text-accent-foreground",
  blue: "bg-primary/15 text-primary",
  amber: "bg-accent/25 text-accent-foreground",
  rose: "bg-destructive/15 text-destructive",
  emerald: "bg-success/15 text-success",
  indigo: "bg-chart-5/20 text-chart-5",
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function ChildAvatar({
  name,
  color = "teal",
  className,
}: {
  name: string
  color?: string
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-heading font-bold",
        COLOR_MAP[color] ?? COLOR_MAP.teal,
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
