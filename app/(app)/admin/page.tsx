import type { Metadata } from "next"
import { ShieldCheck } from "lucide-react"
import { requireAdmin } from "@/lib/auth/guard"
import { getAdminMetrics } from "@/lib/db/admin-metrics"
import {
  MetricAccordion,
  RevenueCard,
  RecentInvoicesCard,
  SubscriptionsCard,
  UsersCard,
  EngagementCard,
  ContentCard,
  OperationsCard,
} from "@/components/app/admin"

// Admin metrics are read live per request; never serve statically cached values (Req 3.4).
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Admin",
  description: "Operator-only business and operational metrics.",
}

export default async function AdminPage() {
  // Gate BEFORE any data fetch: non-admins get 404 and never reach the metrics (Req 3.1, 3.3).
  await requireAdmin()
  const metrics = await getAdminMetrics()

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-6">
        <header
          className="relative overflow-hidden rounded-2xl border border-border p-6 text-primary-foreground shadow-sm sm:p-8"
          style={{
            backgroundImage:
              "linear-gradient(135deg, var(--color-primary), var(--color-chart-5) 55%, var(--color-success))",
          }}
        >
          <div className="relative z-10 flex flex-col gap-3">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-sm">
              <ShieldCheck className="size-3.5" />
              Operator console
            </span>
            <div>
              <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">Admin dashboard</h1>
              <p className="mt-1 max-w-prose text-sm text-primary-foreground/85">
                Read-only business and operational metrics across ApexMaths. Select a section to expand its detail.
              </p>
            </div>
          </div>
          <div className="pointer-events-none absolute -right-12 -top-12 size-44 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-16 right-24 size-40 rounded-full bg-white/10 blur-2xl" />
        </header>

        <MetricAccordion defaultValue={["revenue"]}>
          <RevenueCard section={metrics.revenue} />
          <RecentInvoicesCard section={metrics.invoices} />
          <SubscriptionsCard section={metrics.subscriptions} />
          <UsersCard section={metrics.users} />
          <EngagementCard section={metrics.engagement} />
          <ContentCard section={metrics.content} />
          <OperationsCard section={metrics.operations} />
        </MetricAccordion>
      </div>
    </main>
  )
}
