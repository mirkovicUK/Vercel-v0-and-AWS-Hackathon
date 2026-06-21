import { Receipt } from "lucide-react"
import { formatPrice } from "@/lib/plans"
import type { RecentInvoice, SettledSection } from "@/lib/db/admin-metrics"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { SectionCard } from "@/components/app/admin/section-card"
import { formatAdminDate } from "@/components/app/admin/format"

/**
 * Recent paid invoices: amount (formatted GBP), occurrence date, and the paying
 * parent's email — the only Parent PII shown. An invoice with no `parent_id`
 * (`parentEmail === null`) is rendered as "Unattributed" rather than a fabricated
 * identity (Req 5.2–5.4). An empty list shows an empty-state message (Req 5.5).
 */
export function RecentInvoicesCard({ section }: { section: SettledSection<RecentInvoice[]> }) {
  return (
    <SectionCard title="Recent invoices" description="10 most recent paid invoices" section={section}>
      {(invoices) =>
        invoices.length === 0 ? (
          <Empty className="rounded-xl border border-dashed border-border py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Receipt className="size-6" />
              </EmptyMedia>
              <EmptyTitle>No paid invoices yet</EmptyTitle>
              <EmptyDescription>Paid invoices will appear here once payments are recorded.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {invoices.map((invoice, index) => (
              <li key={index} className="flex items-center justify-between gap-4 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-foreground">
                    {invoice.parentEmail ?? "Unattributed"}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatAdminDate(invoice.occurredAt)}</span>
                </div>
                <span className="font-heading text-sm font-semibold tabular-nums text-foreground">
                  {formatPrice(invoice.amountPence, invoice.currency)}
                </span>
              </li>
            ))}
          </ul>
        )
      }
    </SectionCard>
  )
}
