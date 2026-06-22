"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"
import type { ContactInboxItem } from "@/lib/db/contact"
import { acknowledgeContactAction } from "@/app/(app)/admin/contact-actions"
import { formatAdminDate } from "@/components/app/admin/format"
import { SubmitButton } from "@/components/auth/submit-button"

/**
 * Expandable inbox rows + unread styling + acknowledge control (v2 — design §6b).
 *
 * A `"use client"` list rendered from the already-mapped, PII-firewalled
 * `ContactInboxItem[]` the server `ContactInboxCard` passes in: this component
 * receives **no** new data and issues **no** fetch — it only adds per-row
 * expand/collapse interaction, unread styling, and the single acknowledge
 * control. Every displayed value stays a `{jsxExpression}` so React escapes the
 * stored, untrusted free-text by default; there is **no** `dangerouslySetInnerHTML`
 * anywhere (Req 9.1, 9.2).
 */
export function ContactMessageList({ items }: { items: ContactInboxItem[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((m) => (
        <ContactMessageRow key={m.id} item={m} />
      ))}
    </ul>
  )
}

/**
 * One individually expandable/collapsible message row (Req 12.1). Owns only its
 * own open/close state. The acknowledge `<form action={acknowledgeContactAction}>`
 * (the Acknowledge_Action imported directly — the canonical Next.js pattern for a
 * `"use server"` action consumed by a `"use client"` component) renders **iff**
 * the message is unread AND the row is expanded (Req 12.4, 12.7).
 */
function ContactMessageRow({ item: m }: { item: ContactInboxItem }) {
  const [expanded, setExpanded] = useState(false)
  const isUnread = m.status === "new"

  return (
    <li
      // Req 12.5 — unread gets a distinct treatment: left accent border + tinted bg + unread dot;
      // seen renders muted.
      className={[
        "rounded-xl border p-3.5 transition-colors",
        isUnread
          ? "border-l-2 border-l-primary border-border bg-primary/5"
          : "border-border bg-secondary/20 text-muted-foreground",
      ].join(" ")}
    >
      {/* Collapsed summary: name · date · email · sender-context (Req 12.2). The whole header toggles. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full flex-col gap-1 text-left"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            {isUnread ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" /> : null}
            <span className="truncate text-sm font-medium text-foreground">{m.submitterName}</span>
            <span className="sr-only">{isUnread ? "Unread" : "Seen"}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">{formatAdminDate(m.createdAt)}</span>
            <ChevronRight className={`size-4 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{m.submitterEmail}</span>
        {/* Sender context — escaped text only (Req 8.4–8.6, 9.1) */}
        <span className="text-xs">
          {m.sender.kind === "linked"
            ? `Account: ${m.sender.parentEmail} · ${m.sender.subscriptionStatus}`
            : "Logged-out visitor"}
        </span>
      </button>

      {expanded ? (
        <div className="mt-3 border-t border-border pt-3">
          {/* Full message revealed only when expanded (Req 12.3). React escapes the untrusted text. */}
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{m.message}</p>

          {/* Acknowledge control: shown ONLY while expanded AND unread (Req 12.4, 12.7). */}
          {isUnread ? (
            // The action resolves an `AcknowledgeActionState`; a `<form action>` expects a
            // void-returning handler, so we await-and-discard. On success its own
            // `revalidatePath("/admin")` re-renders the row as `seen` and drops this control.
            <form
              action={async (formData) => {
                await acknowledgeContactAction(formData)
              }}
              className="mt-3"
            >
              <input type="hidden" name="id" value={m.id} />
              <SubmitButton variant="secondary" size="sm" pendingText="Marking as seen…">
                Mark as seen
              </SubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
