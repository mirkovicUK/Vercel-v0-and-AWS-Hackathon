import { Inbox } from "lucide-react"
import type { SettledSection } from "@/lib/db/admin-metrics"
import type { ContactInboxItem } from "@/lib/db/contact"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { MetricSection } from "@/components/app/admin/metric-section"
import { ContactMessageList } from "@/components/app/admin/contact-message-list"

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
          <ContactMessageList items={section.data} />
        )
      ) : null}
    </MetricSection>
  )
}
