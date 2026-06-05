import Link from "next/link"
import { cn } from "@/lib/utils"

export function Logo({
  className,
  href = "/",
  asLink = true,
}: {
  className?: string
  href?: string
  asLink?: boolean
}) {
  const content = (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
          <path d="M4 18L9.5 7l3 6 2-3.5L20 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="font-heading text-lg font-bold tracking-tight text-foreground">
        Apex<span className="text-primary">Maths</span>
      </span>
    </span>
  )

  if (!asLink) return content
  return (
    <Link href={href} aria-label="ApexMaths home">
      {content}
    </Link>
  )
}
