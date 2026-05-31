import Link from "next/link"
import type { ReactNode } from "react"
import { Logo } from "@/components/logo"
import { ShieldCheck } from "lucide-react"

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="flex min-h-screen flex-col bg-secondary/40">
      <header className="px-4 py-5 sm:px-6">
        <Link href="/" aria-label="Apex Maths home">
          <Logo />
        </Link>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            <h1 className="text-balance font-heading text-2xl font-bold tracking-tight text-foreground">{title}</h1>
            {subtitle ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</p> : null}
            <div className="mt-6">{children}</div>
          </div>
          {footer ? <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div> : null}
          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-success" />
            Protected by Amazon Cognito. We never store your password.
          </p>
        </div>
      </div>
    </main>
  )
}
