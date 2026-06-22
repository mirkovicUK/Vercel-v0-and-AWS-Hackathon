import { Inbox } from "lucide-react"
import type { SettledSection } from "@/lib/db/admin-metrics"
import type { ContactInboxItem } from "@/lib/db/contact"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { MetricSection } from "@/components/app/admin/metric-section"
import { formatAdminDate } from "@/components/app/admin/format"

/**
 * Contact inbox: the 50 most recent contact-form submissions with sender context.
 *
 * Presentational, read-only server component (the v1 read-only contract — no
 * mark-read/archive/reply control, no outbound message; Req 11.2, 11.4). Every
 * displayed value is a plain `{jsxExpression}` so React escapes the stored,
 * untrusted free-text by default — there is no `dangerouslySetInnerHTML`
 * anywhere (Req 9.1, 9.2). A `linked` submitter shows the linked Parent's email
 * and subscription status; a `logged_out` submitter is shown as such, never
 * inventing an identity (Req 8.4–8.6). An empty list shows an empty-state
 * message (Req 8.7).
 */
export function ContactInboxCard({ section }: { section: SettledSection<ContactInboxItem[]> }) {
  return (
    <MetricSection
      id="contact"
      title="Contact inbox"
      description="50 most recent contact messages"
      icon={<Inbox className="size-5" />}
      accent="steel"
      hasError={!section.ok}
      preview={
        section.ok ? (
          <>
            {section.data.length}
            <span className="ml-1 text-xs font-normal text-muted-foreground">messages</span>
          </>
        ) : null
      }
    >
      {section.ok ? (
        section.data.length === 0 ? (
          <Empty className="rounded-xl border border-dashed border-border py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox className="size-6" />
              </EmptyMedia>
              <EmptyTitle>No contact messages yet</EmptyTitle>
              <EmptyDescription>Messages sent through the contact form will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {section.data.map((m) => (
              <li key={m.id} className="rounded-xl border border-border bg-secondary/40 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-foreground">{m.submitterName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatAdminDate(m.createdAt)}</span>
                </div>
                <div className="text-xs text-muted-foreground">{m.submitterEmail}</div>
                {/* Sender context — escaped text only (Req 8.4–8.6, 9.1) */}
                <div className="mt-1 text-xs">
                  {m.sender.kind === "linked" ? (
                    <span className="text-foreground">
                      Account: {m.sender.parentEmail} · {m.sender.subscriptionStatus}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Logged-out visitor</span>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{m.message}</p>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </MetricSection>
  )
}
