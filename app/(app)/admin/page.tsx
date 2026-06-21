import type { Metadata } from "next"
import { requireAdmin } from "@/lib/auth/guard"
import { getAdminMetrics } from "@/lib/db/admin-metrics"
import {
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
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only business and operational metrics across the platform.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <RevenueCard section={metrics.revenue} />
          <SubscriptionsCard section={metrics.subscriptions} />
          <UsersCard section={metrics.users} />
          <ContentCard section={metrics.content} />
          <EngagementCard section={metrics.engagement} />
          <RecentInvoicesCard section={metrics.invoices} />
          <OperationsCard section={metrics.operations} />
        </div>
      </div>
    </main>
  )
}
