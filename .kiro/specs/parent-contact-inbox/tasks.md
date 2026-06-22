# Implementation Plan: Parent Contact Inbox

## Overview

This plan converts the Parent Contact Inbox design into incremental, code-only steps for the
existing Next.js (App Router) + TypeScript codebase. The feature adds two surfaces: a **public,
unauthenticated, write-capable** "Contact us" form whose server action persists one row to a new
Aurora table `contact_messages`, and an operator-only, read-only inbox card folded into the existing
`/admin` dashboard. It introduces **no new infrastructure and no new authorization path**.

Work flows bottom-up so each step ends wired into the previous one with no orphaned code: first the
migration that defines `contact_messages`, then the new `AuditAction` value the action depends on,
then the server-only `lib/db/contact.ts` module (constants, Zod schema, types, pure helpers, and the
INSERT / rate-limit-count / inbox `SELECT` DB functions), then the Submit_Action that orchestrates
the pure gates and DB calls in a fixed order, then the public form page + client component, the
footer link, and finally the admin fold-in (aggregator section + inbox card) rendered on `/admin`.

The feature reuses existing platform patterns, unchanged: the `requireAdmin()` guard
(`lib/auth/guard.ts`, fail-closed HTTP 404), the RDS Data API helpers (`query`/`queryOne` from
`lib/aws/rds-data.ts`) for the parameterized INSERT, the rate-limit count, and the `SELECT`-only
inbox read, the `SettledSection<T>` wrapper and `Promise.allSettled` aggregator in
`lib/db/admin-metrics.ts`, the append-only `audit()` writer in `lib/db/audit.ts`, the
`MetricSection` collapsible-card shell in `components/app/admin/`, the marketing footer + form
primitives (`useActionState`, `SubmitButton`, `Input`, `Label`, `Textarea`), and Vitest + fast-check
property tests mirroring `app/(app)/billing/actions.test.ts`.

> **DEPLOYMENT PREREQUISITE (not an implementation task):** The new migration
> `scripts/sql/003_contact.sql` must be applied to Aurora by running `scripts/migrate.mjs` before the
> feature works end-to-end — the `contact_messages` table must exist before any submission can be
> persisted or any inbox read can succeed. Creating the migration *file* is the code task below;
> *running* the migration is a deploy step (analogous to the admin-dashboard spec's Cognito `admins`
> group provisioning, which is operational rather than code).

## Tasks

- [x] 1. Create the `contact_messages` migration
  - [x] 1.1 Author `scripts/sql/003_contact.sql`
    - Create a new idempotent, additive migration following the `001_schema.sql` conventions exactly (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, TEXT id defaulting to `gen_random_uuid()::text`, `TIMESTAMPTZ` timestamps). `003` is the next free number after `002_adaptive.sql`.
    - Define `contact_messages` columns: `id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text`; `parent_id TEXT REFERENCES parents(id) ON DELETE SET NULL` (null when logged out; de-attributes on erasure, matching the `revenue_events` GDPR precedent); `name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80)`; `email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254)`; `message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 10 AND 2000)`; `status TEXT NOT NULL DEFAULT 'new'`; `source_ip TEXT` (nullable, rate-limit only, never displayed); `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
    - Create the four indexes: `idx_contact_created` on `(created_at DESC)`, `idx_contact_email_created` on `(email, created_at)`, `idx_contact_ip_created` on `(source_ip, created_at)`, and `idx_contact_parent` on `(parent_id)` — all `IF NOT EXISTS`.
    - _Requirements: 2.2, 2.3, 2.4, 2.6, 3.1, 3.5, 8.1, 8.2, 10.5_

- [x] 2. Add the `contact.submitted` audit action
  - [x] 2.1 Extend the `AuditAction` union in `lib/db/audit.ts`
    - Add `"contact.submitted"` as a new member of the `AuditAction` union (under a "Contact" group comment), so the Submit_Action can record an accepted submission through the existing append-only `audit()` writer with no other change to the audit module.
    - _Requirements: 6.1_

- [x] 3. Create the contact data layer: constants, schema, types, pure helpers, and DB functions
  - [x] 3.1 Implement `lib/db/contact.ts` constants, schema, types, and pure helpers
    - Create `lib/db/contact.ts` with `import "server-only"`, `import { z } from "zod"`, `import { query, queryOne } from "@/lib/aws/rds-data"`, and the `SubscriptionStatus` type from `@/lib/domain`.
    - Define the tunable named constants: `RATE_LIMIT_WINDOW_MINUTES = 60`, `RATE_LIMIT_MAX = 5`, `INBOX_ROW_LIMIT = 50`.
    - Define `Contact_Schema` (Zod) with `name` (`.trim().min(1).max(80)` with friendly messages), `email` (`.trim().toLowerCase().min(3).max(254).email()`), and `message` (`.trim().min(10).max(2000)`); export `type ContactInput = z.infer<typeof Contact_Schema>` and a `ContactValidationResult` shape.
    - Define the types: raw `ContactInboxRow` (`id`, `submitter_name`, `submitter_email`, `message`, `created_at`, `parent_id`, `linked_parent_email`, `subscription_status`), the payload `ContactInboxItem` (`id`, `submitterName`, `submitterEmail`, `message`, `createdAt`, `sender`), and the total `SenderContext` union (`{ kind: "logged_out" }` | `{ kind: "linked"; parentEmail; subscriptionStatus: SubscriptionStatus | "none" }`) — none carrying any forbidden field (the type-level PII firewall).
    - Implement the pure, I/O-free helpers: `validateContactInput(raw)` (safeParse → first issue message on failure), `isHoneypotTriggered(value)` (true iff string with trimmed length > 0), `isRateLimited(counts, max = RATE_LIMIT_MAX)` (true iff `byEmail >= max || byIp >= max`), `mapSenderContext(row)` (total over the three triage cases), `mapContactInboxRow(row)` (project to the PII-bounded payload), and `orderAndLimitByCreatedAtDesc(rows, limit)` (sort by `created_at` desc, keep the most-recent `limit`) so the ordering property is testable in-memory.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.2, 4.3, 5.2, 8.1, 8.4, 8.5, 8.6, 10.2, 10.3, 10.4_

  - [x] 3.2 Add the DB functions and `readSourceIp()` to `lib/db/contact.ts`
    - Implement `countRecentSubmissions(email, ip, windowMinutes = RATE_LIMIT_WINDOW_MINUTES)` as a single parameterized `SELECT` using `COUNT(*) FILTER (...)` for `by_email` and `by_ip` over rows where `created_at >= now() - make_interval(mins => :windowMinutes)` (no new infrastructure).
    - Implement `deriveParentId()` returning `(await getCurrentParent())?.id ?? null` (import `getCurrentParent` from `@/lib/auth/session`) — derived only from the verified session, reading no client-supplied identifier.
    - Implement `insertContactMessage({ name, email, message, parentId, sourceIp })` as a parameterized `INSERT INTO contact_messages (...) VALUES (...)` with `status` hard-coded to `'new'` in the SQL text and `created_at` left to default — every value bound, never interpolated.
    - Export the `CONTACT_INBOX_SQL` string constant (the single `LEFT JOIN contact_messages → parents → subscriptions`, `ORDER BY cm.created_at DESC`, `LIMIT :limit`, selecting only the permitted columns — never `parents.id`/`sub`, `stripe_customer_id`, `source_ip`, or any child column) and implement `getContactInbox(): Promise<ContactInboxItem[]>` calling `query<ContactInboxRow>(CONTACT_INBOX_SQL, { limit: INBOX_ROW_LIMIT })` and mapping via `mapContactInboxRow`.
    - Implement `readSourceIp(): Promise<string | null>` reading the first hop of `x-forwarded-for` via `headers()` from `next/headers`, returning `null` when absent.
    - _Requirements: 2.5, 2.6, 3.2, 3.3, 3.4, 3.6, 4.1, 4.2, 4.3, 4.5, 8.1, 8.2, 8.3, 11.1_

  - [ ]* 3.3 Write property test for validation bounds
    - In a new `lib/db/contact.test.ts`, tag `// Feature: parent-contact-inbox, Property 1: Validation accepts exactly the in-bounds, well-formed inputs`.
    - Generate random name/email/message including whitespace-only, boundary lengths (0,1,80,81 / 2,3,254,255 / 9,10,2000,2001) and valid + garbage emails; assert `validateContactInput` returns `ok: true` iff trimmed name ∈ [1,80] ∧ email valid ∧ length ∈ [3,254] ∧ trimmed message ∈ [10,2000], and otherwise returns `ok: false` with a descriptive error and no `data`.
    - Use fast-check with `{ numRuns: 200 }`.
    - **Property 1: Validation accepts exactly the in-bounds, well-formed inputs**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

  - [ ]* 3.4 Write property test for honeypot detection
    - Tag `// Feature: parent-contact-inbox, Property 2: A non-empty honeypot is always detected`.
    - Generate random values including `undefined`, non-strings, `""`, whitespace-only, and non-empty strings; assert `isHoneypotTriggered(value)` returns true iff the value is a string whose trimmed length > 0.
    - fast-check `{ numRuns: 200 }`.
    - **Property 2: A non-empty honeypot is always detected**
    - **Validates: Requirements 5.2**

  - [ ]* 3.5 Write property test for the rate-limit decision
    - Tag `// Feature: parent-contact-inbox, Property 3: Rate-limit decision rejects once either count reaches the allowance`.
    - Generate random `byEmail`, `byIp`, and `max` (including the equal-to-`max` boundary); assert `isRateLimited(counts, max)` returns true iff `byEmail >= max || byIp >= max`, and false iff both are strictly below `max`.
    - fast-check `{ numRuns: 200 }`.
    - **Property 3: Rate-limit decision rejects once either count reaches the allowance**
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 3.6 Write property test for parent linkage
    - Tag `// Feature: parent-contact-inbox, Property 4: Parent linkage comes only from the verified session`.
    - Model the linkage rule as a pure function of a session value (`{ id } | null`, mirroring how `deriveParentId` consumes `getCurrentParent()`); generate random session values and assert the derived id equals the Parent's `id` when present, equals `null` when absent, and depends on nothing else.
    - fast-check `{ numRuns: 200 }`.
    - **Property 4: Parent linkage comes only from the verified session**
    - **Validates: Requirements 3.2, 3.3, 3.4**

  - [ ]* 3.7 Write property test for sender-context mapping
    - Tag `// Feature: parent-contact-inbox, Property 5: Sender-context mapping is total over the three triage cases`.
    - Generate random joined rows over the three cases (null parent, parent + subscription, parent + no subscription); assert `mapSenderContext` returns `logged_out` iff `parent_id` or `linked_parent_email` is null (never inventing an identity), a `linked` context carrying email + status when both present, and `subscriptionStatus: "none"` (never invented) when the subscription is null.
    - fast-check `{ numRuns: 200 }`.
    - **Property 5: Sender-context mapping is total over the three triage cases**
    - **Validates: Requirements 8.4, 8.5, 8.6**

  - [ ]* 3.8 Write property test for inbox ordering and bound
    - Tag `// Feature: parent-contact-inbox, Property 6: Inbox ordering and bound`.
    - Generate random oversized candidate row sets with random `created_at` values (including ties) and a random positive limit; assert `orderAndLimitByCreatedAtDesc(rows, limit)` returns no more than `limit` rows, sorted `created_at` descending, retaining exactly the most-recent `limit` rows.
    - fast-check `{ numRuns: 200 }`.
    - **Property 6: Inbox ordering and bound**
    - **Validates: Requirements 8.1**

  - [ ]* 3.9 Write property test for the PII firewall over inbox payloads
    - Tag `// Feature: parent-contact-inbox, Property 7: PII firewall over every inbox payload`.
    - Generate random `ContactInboxRow` inputs, map via `mapContactInboxRow`, and assert the serialized payload's keys are a subset of `{ id, submitterName, submitterEmail, message, createdAt, sender }` and the `sender` object's keys a subset of `{ kind, parentEmail, subscriptionStatus }` — never `parents.id`/Cognito `sub`, `stripe_customer_id`, `source_ip`, or any child attribute.
    - fast-check `{ numRuns: 200 }`.
    - **Property 7: PII firewall over every inbox payload**
    - **Validates: Requirements 10.2, 10.3, 10.4**

  - [ ]* 3.10 Write property test for SELECT-only inbox SQL
    - Tag `// Feature: parent-contact-inbox, Property 8: Inbox service issues only read statements`.
    - Assert `CONTACT_INBOX_SQL` matches `/^\s*(WITH|SELECT)\b/i` and contains no `INSERT`/`UPDATE`/`DELETE`/`MERGE`/`UPSERT`/`ALTER`/`DROP`/`CREATE`/`TRUNCATE` keyword.
    - fast-check `{ numRuns: 200 }` (e.g. over the set of forbidden keywords).
    - **Property 8: Inbox service issues only read statements**
    - **Validates: Requirements 11.1, 11.3**

- [x] 4. Checkpoint - migration, audit action, and data layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement the Submit_Action
  - [x] 5.1 Create `app/contact/actions.ts`
    - Create a `"use server"` module exporting `ContactActionState` (`{ ok: boolean; error?: string }`) and `submitContactAction(_prev, formData)` returning that shape.
    - Orchestrate the fixed-order gauntlet using the pure helpers and DB functions (no decision logic of its own): (1) `validateContactInput` from `formData` name/email/message — return `{ ok: false, error }` on failure with no persistence; (2) `isHoneypotTriggered(formData.get("website"))` — return `{ ok: true }` (silent success, no row, no tell); (3) `readSourceIp()` then `countRecentSubmissions(email, ip)` then `isRateLimited(...)` — return `{ ok: false, error: "…try again later." }` on reject with no persistence; (4) `deriveParentId()` from the verified session only; (5) `insertContactMessage({ ...data, parentId, sourceIp: ip })`; (6) best-effort `audit({ action: "contact.submitted", parentId: parentId ?? undefined })` carrying no PII beyond the action and verified `parentId`.
    - Do not call `revalidatePath`/`redirect`; the form shows an inline success state, so return the result.
    - _Requirements: 2.1, 2.5, 2.6, 3.2, 3.3, 3.4, 3.6, 4.1, 4.4, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4_

  - [ ]* 5.2 Write example tests for the Submit_Action
    - In `app/contact/actions.test.ts`, with the `lib/db/contact` helpers and `audit` mocked: happy path (valid, honeypot empty, not rate-limited) calls `insertContactMessage` exactly once and `audit` once with `action: "contact.submitted"` and the verified `parentId` (Req 2.5, 6.1, 6.2); a non-empty `website` honeypot returns `{ ok: true }` and does **not** call `insertContactMessage` (Req 5.3); `isRateLimited` true returns `{ ok: false }` with the "try again later" copy and no insert (Req 4.4); `audit` rejecting still returns `{ ok: true }` after the insert (Req 6.4); `getCurrentParent` → a parent passes that `parentId` to the insert, `null` passes `null` (Req 3.2, 3.3).
    - _Requirements: 2.5, 3.2, 3.3, 4.4, 5.3, 6.1, 6.2, 6.4_

- [x] 6. Build the public contact form
  - [x] 6.1 Create the contact form page `app/contact/page.tsx`
    - Create a server component outside the `(app)`/`(auth)` route groups (so no guard runs and it is reachable logged-out), exporting `metadata` and rendering the marketing chrome (`<main>` + heading/intro + `MarketingFooter`).
    - Call `getCurrentParent()` **only** to prefill the email (tolerating `null`) and render `<ContactForm defaultEmail={parent?.email ?? ""} />`.
    - _Requirements: 1.2, 1.3, 1.4, 10.1_

  - [x] 6.2 Create the contact form client component `components/marketing/contact-form.tsx`
    - Create a `"use client"` component using `useActionState(submitContactAction, { ok: false })` and the shared `SubmitButton`, rendering name/email/message inputs (with `defaultEmail` prefill) via `Label`/`Input`/`Textarea`.
    - Add the hidden honeypot `website` field inside an `aria-hidden="true"`, off-screen (`left-[-9999px]`) wrapper with `tabIndex={-1}` and `autoComplete="off"` so genuine/keyboard/screen-reader users never see or tab to it.
    - Render the success state (on `state.ok`) and an inline `role="alert"` error state (on `state.error`); client-side `required`/`maxLength`/`minLength` are UX affordances only.
    - _Requirements: 1.3, 5.1, 10.1_

  - [ ]* 6.3 Write unit tests for the contact form
    - In `components/marketing/contact-form.test.tsx`: assert `ContactForm` renders name/email/message inputs and a hidden `website` honeypot that is `aria-hidden`, `tabIndex=-1`, and off-screen, with no other PII inputs (Req 1.3, 5.1, 10.1).
    - _Requirements: 1.3, 5.1, 10.1_

- [x] 7. Add the footer "Contact us" link
  - [x] 7.1 Extend `components/marketing/marketing-footer.tsx`
    - Add a single link to `/contact` labelled "Contact us" in the existing footer column structure, navigating to the contact form page.
    - _Requirements: 1.1_

- [x] 8. Checkpoint - public submission flow wired end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Fold the inbox into the admin aggregator
  - [x] 9.1 Extend `AdminMetrics` and `getAdminMetrics()` in `lib/db/admin-metrics.ts`
    - Import `getContactInbox` and re-export the `ContactInboxItem` type from `@/lib/db/contact`.
    - Add `contactInbox: SettledSection<ContactInboxItem[]>` to the `AdminMetrics` interface.
    - Add `getContactInbox()` as a new entry in the existing `Promise.allSettled` array (dispatched in the same batch, concurrent, never awaited individually) and map its result with the existing `settle()` combinator. Make no other change to the aggregator.
    - _Requirements: 7.2, 8.1, 8.2, 8.8_

  - [ ]* 9.2 Extend the resilience property test for the inbox section
    - In `lib/db/admin-metrics.test.ts`, tag `// Feature: parent-contact-inbox, Property 9: Per-section failure isolation`.
    - Generate a random success/failure vector over all admin sections including the new `contactInbox`; assert `getAdminMetrics()` always resolves (never rejects), marks exactly the failed sections `{ ok: false }` (including the inbox) and every other section `{ ok: true, data }`, so an inbox failure never blanks another section and vice versa.
    - fast-check `{ numRuns: 200 }`.
    - **Property 9: Per-section failure isolation**
    - **Validates: Requirements 8.1, 8.8**

- [x] 10. Build and wire the inbox card
  - [x] 10.1 Implement and export `components/app/admin/contact-inbox-card.tsx`
    - Create a presentational server component (accent `steel`) accepting `section: SettledSection<ContactInboxItem[]>`, passing `hasError={!section.ok}` to `MetricSection` and showing the message count as `preview`.
    - Render the empty state when `section.ok && data.length === 0` (Req 8.7); otherwise list each message rendering `submitterName`, `submitterEmail`, `message`, and `createdAt` (via the existing date formatter), plus sender context — a `linked` row shows the linked parent email + subscription status, a `logged_out` row shows "Logged-out visitor" (never inventing an identity). Every displayed value is a `{jsxExpression}` (React escapes by default); use **no** `dangerouslySetInnerHTML`. Present no mark-read/archive/reply control and trigger no outbound message (v1 read-only contract).
    - Export the component from `components/app/admin/index.ts`.
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 9.1, 9.2, 10.2, 10.3, 10.4, 11.2, 11.4_

  - [x] 10.2 Render the inbox card on `app/(app)/admin/page.tsx`
    - Inside the existing `MetricAccordion` (keeping the unchanged `force-dynamic` + `requireAdmin()`-before-`getAdminMetrics()` flow), render `<ContactInboxCard section={metrics.contactInbox} />` grouped with the existing cards.
    - _Requirements: 7.1, 7.3, 7.5, 8.8_

  - [ ]* 10.3 Write unit tests for the inbox card
    - In `components/app/admin/contact-inbox-card.test.tsx`: one item renders name/email/message/date; a `linked` sender renders the parent email + subscription status; a `logged_out` sender renders "Logged-out visitor"; `[]` renders the empty state; a `section` with `ok: false` renders the `MetricSection` error indicator; a `message` containing `"<script>alert(1)</script>"` renders as literal text (React escaping) and the component contains no `dangerouslySetInnerHTML` (P9 resilience extension + XSS-as-text).
    - _Requirements: 8.3, 8.7, 9.1, 9.2_

- [x] 11. Final checkpoint - full feature wired together
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks (the non-`*` ones) are never optional.
- Each task references specific granular requirements clauses for traceability.
- Property tests use fast-check with `{ numRuns: 200 }` (≥ the 100-iteration minimum) and mirror the established pattern in `app/(app)/billing/actions.test.ts`, including the `// Feature: parent-contact-inbox, Property N: ...` tag.
- All 9 correctness properties from the design are covered: P1 (3.3), P2 (3.4), P3 (3.5), P4 (3.6), P5 (3.7), P6 (3.8), P7 (3.9), P8 (3.10), P9 (9.2).
- The data layer (`lib/db/contact.ts`) performs no authorization — the inbox read is gated once at the `/admin` boundary via the reused `requireAdmin()` guard (fail-closed HTTP 404), so no task re-implements auth.
- The PII firewall is structural: `ContactInboxItem`/`SenderContext` have no slot for any forbidden field, and `CONTACT_INBOX_SQL` never selects `source_ip`, `parents.id`/`sub`, `stripe_customer_id`, or any child column.
- The submission gauntlet is fail-stopped (validate → honeypot → rate-limit → derive → persist → audit), so no malformed, bot, or throttled submission can write a row, and `parent_id` flows only from the verified session.
- **Deployment prerequisite:** run `scripts/migrate.mjs` to apply `003_contact.sql` before the feature works — the table must exist before submissions persist or the inbox reads. This is an operational deploy step, not a code task.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "7.1"] },
    { "id": 1, "tasks": ["3.2"] },
    { "id": 2, "tasks": ["3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "5.1", "9.1"] },
    { "id": 3, "tasks": ["5.2", "6.2", "9.2", "10.1"] },
    { "id": 4, "tasks": ["6.1", "6.3", "10.2", "10.3"] }
  ]
}
```
