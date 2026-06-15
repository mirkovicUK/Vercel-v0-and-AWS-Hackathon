# Implementation Plan: Admin Dashboard

## Overview

This plan converts the Admin Dashboard design into incremental, code-only steps for the existing
Next.js (App Router) + TypeScript codebase. Work flows from the trusted authorization core (group
claims → guard) outward to the read-only Metrics_Service, the server-rendered page, the metric card
components, and finally the conditional nav link. Each step builds on the previous one and ends with
the pieces wired together so there is no orphaned code.

The feature reuses existing platform patterns: server components, the RDS Data API helpers
(`lib/aws/rds-data.ts`), the existing revenue helper (`lib/db/revenue.ts`), currency formatting
(`lib/plans.ts` `formatPrice`), the audit log (`lib/db/audit.ts`), and Vitest + fast-check property
tests mirroring `app/(app)/billing/actions.test.ts`.

> **NON-CODE SETUP PREREQUISITE (not an implementation task):** The Amazon Cognito user-pool group
> named `admins` must be created **manually in the Cognito console**, and admin parents must be added
> to it there. This is a deployment/operations step performed outside the codebase and is intentionally
> **not** included as a task below. Note also the documented token-refresh nuance: a newly-added admin
> only gains access after their ID token is refreshed (re-login or token expiry).

## Tasks

- [ ] 1. Expose Cognito group membership from the verified token
  - [ ] 1.1 Extend the Session_Service with group-aware claims
    - In `lib/auth/session.ts`, add `groups: string[]` to the `IdClaims` interface.
    - Add a pure `readGroups(payload)` normalizer: `string[]` claim → that list, single `string` → one-element list, absent/undefined → `[]` (always returns an array).
    - Read `payload["cognito:groups"]` via `readGroups` on **both** the direct-verify path and the token-refresh path of `getVerifiedClaims()`, populating `groups`.
    - Keep `sub` and `email` returned unchanged.
    - Add and export the pure predicate `isAdminClaims(claims: IdClaims | null): boolean` returning `true` iff claims are non-null and `groups` includes the `admins` group constant.
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 1.2 Write property test for group claim normalization
    - In a new `lib/auth/session.test.ts`, tag `// Feature: admin-dashboard, Property 1: Group claim normalization`.
    - Generate payloads whose `cognito:groups` is a `string[]`, a single `string`, or absent; assert `readGroups` always returns a `string[]` exactly matching the claim (single → one element, absent → `[]`), never a non-array.
    - Use fast-check with `{ numRuns: 200 }`.
    - **Property 1: Group claim normalization**
    - **Validates: Requirements 1.1, 1.2**

- [ ] 2. Extend the audit action vocabulary
  - [ ] 2.1 Add admin audit actions
    - In `lib/db/audit.ts`, add `"admin.denied"` and `"admin.viewed"` to the `AuditAction` union type.
    - _Requirements: 2.5_

- [ ] 3. Provide and enforce the server-side admin guard
  - [ ] 3.1 Implement `requireAdmin()`
    - In `lib/auth/guard.ts`, add `requireAdmin(): Promise<Parent>` mirroring the shape of `requireEntitledParent()`.
    - Resolve verified claims via `getCurrentClaims()` only; read no client-supplied header, query parameter, or cookie other than the verified session tokens.
    - Fail closed: when `isAdminClaims(claims)` is false (null claims or no `admins` group), `await audit({ action: "admin.denied", parentId: claims?.sub ?? null })` then call `notFound()` (HTTP 404) so no metric fetch is reachable on denial.
    - On success, return the identity via `getCurrentParent()`; if the row is missing, defensively `notFound()`.
    - Structure the decision so it is unit/property testable (e.g. a pure `decideAdminAccess(claims)` core, or injectable `getCurrentClaims`/`getCurrentParent`/`audit`/`notFound` dependencies).
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.3_

  - [ ]* 3.2 Write property test for admin access decision
    - Tag `// Feature: admin-dashboard, Property 2: Admin access allowed iff 'admins' in verified groups`.
    - Generate `null` claims and claims with random groups (sometimes including `admins`); assert authorization succeeds iff claims are non-null and contain `admins`, otherwise it denies (throws the not-found signal) and the aggregator is never invoked.
    - fast-check `{ numRuns: 200 }`, mirroring `app/(app)/billing/actions.test.ts`.
    - **Property 2: Admin access allowed iff `admins` in verified groups**
    - **Validates: Requirements 2.1, 2.2, 2.3, 3.3**

  - [ ]* 3.3 Write property test for denial auditing
    - Tag `// Feature: admin-dashboard, Property 3: Denials are audited with the requesting sub only`.
    - Generate non-admin claims (null or lacking `admins`); assert the audit spy is called exactly once with action `admin.denied` and `parentId === sub ?? null`, with no other PII.
    - fast-check `{ numRuns: 200 }`.
    - **Property 3: Denials are audited with the requesting sub only**
    - **Validates: Requirements 2.5**

- [ ] 4. Build the read-only Metrics_Service
  - [ ] 4.1 Create types and pure mapping helpers
    - Create `lib/db/admin-metrics.ts` (server-only). Define the payload interfaces: `RecentInvoice`, `SubscriptionMetrics`, `UserMetrics`, `EngagementMetrics`, `ContentMetrics`, `ProcessedWebhookEvent`, `AuditEntry`, `OperationalMetrics`, `AdminMetrics`, and the `SettledSection<T>` union.
    - Implement the pure, in-memory helpers extracted for testability: `mapGroupedCounts` (rows → keyed record over a fixed key set, missing → `0`), `mapInvoiceRow` (null `parent_id` → `parentEmail: null`), `classifyWithin30Days` (inclusive `[now − 30d, now]`), and `settle<T>(PromiseSettledResult<T>)`.
    - Ensure payload types contain no child field, no `sub`, no `stripe_customer_id`, no question `text`/`options`/`correct_index`, and no audit `detail` (PII firewall by construction).
    - _Requirements: 6.2, 6.3, 7.5, 9.4, 10.5, 12.1, 12.2, 12.3, 12.4, 14.3_

  - [ ] 4.2 Implement the SELECT-only query functions and concurrent aggregator
    - In `lib/db/admin-metrics.ts`, implement one read-only function per metric group using `query`/`queryOne` from `lib/aws/rds-data.ts`: recent 10 invoices (`LEFT JOIN parents`, email only), subscription counts by status + `cancel_at_period_end`, parent active/soft-deleted/30-day-new + active children, session totals/by-status/30-day/`help_used` sum + review reports by `generated_by`, content totals/by-topic/active-inactive, and operational health (10 webhook events, 20 audit entries — `detail` never selected).
    - Reuse `getRevenueSummary()` from `lib/db/revenue.ts` for the revenue overview.
    - Use single `COUNT/SUM/GROUP BY` aggregate queries for grouped metrics and explicit `LIMIT`s for list queries.
    - Implement `getAdminMetrics()` running the independent queries concurrently via `Promise.allSettled`, mapping each result with `settle` so one failing section does not blank the others.
    - _Requirements: 4.5, 5.1, 5.2, 5.3, 5.4, 6.1, 6.4, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 10.4, 11.1, 11.2, 13.1, 13.2, 13.3, 14.3_

  - [ ]* 4.3 Write property test for grouped count completeness
    - Tag `// Feature: admin-dashboard, Property 4: Grouped counts are complete and sum to the total`.
    - Generate random `(key, count)` row multisets across subscription status, session status, review generator, and topic domains; assert every expected key is present (missing → `0`), no negative counts, and the sum equals the underlying row total.
    - fast-check `{ numRuns: 200 }`.
    - **Property 4: Grouped counts are complete and sum to the total**
    - **Validates: Requirements 6.1, 6.2, 6.3, 8.2, 8.4, 9.2**

  - [ ]* 4.4 Write property test for count decompositions
    - Tag `// Feature: admin-dashboard, Property 5: Count decompositions partition the total`.
    - Generate random parent and question row sets; assert `activeParents + deletedParents === totalParents` and `activeQuestions + inactiveQuestions === totalQuestions`.
    - fast-check `{ numRuns: 200 }`.
    - **Property 5: Count decompositions partition the total**
    - **Validates: Requirements 7.1, 7.2, 9.3**

  - [ ]* 4.5 Write property test for 30-day window classification
    - Tag `// Feature: admin-dashboard, Property 6: 30-day window classification is correct`.
    - Generate random timestamped rows and a random `now`; assert `classifyWithin30Days` count equals an in-memory `[now − 30d, now]` filter (boundary inclusive, future excluded; parents additionally require `deleted_at IS NULL`).
    - fast-check `{ numRuns: 200 }`.
    - **Property 6: 30-day window classification is correct**
    - **Validates: Requirements 7.3, 8.3**

  - [ ]* 4.6 Write property test for the PII firewall
    - Tag `// Feature: admin-dashboard, Property 7: PII firewall over every admin payload`.
    - Generate random metrics payloads from random rows; assert the serialized payload contains no child field, no `sub`, no `stripe_customer_id`, no question `text`/`options`/`correct_index`, and no audit `detail`; the only permitted personal field is `parentEmail`, which is `null` for unattributed invoices.
    - fast-check `{ numRuns: 200 }`.
    - **Property 7: PII firewall over every admin payload**
    - **Validates: Requirements 5.3, 5.4, 7.5, 9.4, 10.5, 12.1, 12.2, 12.3, 12.4**

  - [ ]* 4.7 Write property test for list bounds and ordering
    - Tag `// Feature: admin-dashboard, Property 8: List queries are bounded and ordered`.
    - Generate random oversized datasets for recent invoices, webhook events, and audit entries; assert mapped list length never exceeds its bound (10, 10, 20) and items are ordered by timestamp descending.
    - fast-check `{ numRuns: 200 }`.
    - **Property 8: List queries are bounded and ordered**
    - **Validates: Requirements 5.1, 10.1, 10.3, 13.2**

  - [ ]* 4.8 Write property test for SELECT-only statements
    - Tag `// Feature: admin-dashboard, Property 9: Metrics_Service issues only read statements`.
    - Capture the service's SQL strings (constants or via a mock `query`); assert each matches `/^\s*SELECT/i` and contains no `INSERT`/`UPDATE`/`DELETE`/`ALTER`/`DROP` or other mutating keyword.
    - fast-check `{ numRuns: 200 }`.
    - **Property 9: Metrics_Service issues only read statements**
    - **Validates: Requirements 11.1, 11.2**

  - [ ]* 4.9 Write property test for per-section failure isolation
    - Tag `// Feature: admin-dashboard, Property 10: Per-section failure isolation`.
    - Generate a random success/failure vector over the sections; assert `getAdminMetrics()` always resolves and marks exactly the failed sections `{ ok: false }` and the rest `{ ok: true, data }`.
    - fast-check `{ numRuns: 200 }`.
    - **Property 10: Per-section failure isolation**
    - **Validates: Requirements 14.3**

- [ ] 5. Checkpoint - core authorization and metrics
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Build the admin metric card components
  - [ ] 6.1 Implement the metric card components
    - Create `components/app/admin/` presentational server components mirroring `child-progress-card.tsx`, built on `components/ui/card` (`Card`, `CardContent`).
    - Add a shared `SectionCard` wrapper that renders a title and, when `section.ok === false`, an inline error indicator instead of the body.
    - Implement `RevenueCard`, `RecentInvoicesCard`, `SubscriptionsCard`, `UsersCard`, `EngagementCard`, `ContentCard`, `OperationsCard`, each accepting its `SettledSection<T>`.
    - Format currency with `formatPrice` from `lib/plans.ts`; render unattributed invoices (`parentEmail === null`) as "Unattributed"; reuse existing empty-state components for no-data cases (e.g. no invoices).
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.2, 5.3, 5.4, 5.5, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 10.2, 10.4, 11.3, 14.3_

  - [ ]* 6.2 Write unit tests for the metric cards
    - Revenue card renders `formatPrice(totalRevenuePence)`, paying-parent count, and first-paid date; a zero summary renders `£0.00` and `0`.
    - Invoice card renders a null-`parentEmail` row as "Unattributed" and an empty list as the empty-state message.
    - A `SettledSection` with `ok: false` renders the error indicator and still allows other cards to render.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.4, 5.5, 14.3_

- [ ] 7. Wire up the admin page
  - [ ] 7.1 Create the force-dynamic admin page
    - Create `app/(app)/admin/page.tsx` exporting `export const dynamic = "force-dynamic"`.
    - Call `requireAdmin()` before any data fetch, then `getAdminMetrics()`, then render the metric cards from task 6.1, each reading its `metrics.<section>`.
    - _Requirements: 3.1, 3.2, 3.4, 4.1, 4.2, 4.3, 11.1, 11.3_

- [ ] 8. Add the conditional admin nav entry point
  - [ ] 8.1 Compute admin status in the app layout
    - In `app/(app)/layout.tsx`, alongside `requireParent()`, compute `isAdmin` via `isAdminClaims(await getCurrentClaims())` and pass it to `<AppHeader email={parent.email} isAdmin={isAdmin} />`.
    - _Requirements: 14.1, 14.2_

  - [ ] 8.2 Render the conditional `/admin` link in the header
    - In `components/app/app-header.tsx`, accept an `isAdmin` prop and render the `/admin` link (ghost `Button` + `DropdownMenuItem`, matching existing Dashboard/Billing entries, reusing the `ShieldCheck` icon) only when `isAdmin` is true; render no link when false.
    - _Requirements: 14.1, 14.2_

  - [ ]* 8.3 Write unit test for the conditional nav link
    - Assert the header renders the `/admin` link when `isAdmin` is true and omits it when `isAdmin` is false.
    - _Requirements: 14.1, 14.2_

- [ ] 9. Final checkpoint - full feature wired together
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific granular requirements clauses for traceability.
- Property tests use fast-check with `{ numRuns: 200 }` (≥ the 100-iteration minimum) and mirror the established pattern in `app/(app)/billing/actions.test.ts`, including the `// Feature: admin-dashboard, Property N: ...` tag.
- All 10 correctness properties from the design are covered: P1 (1.2), P2 (3.2), P3 (3.3), P4 (4.3), P5 (4.4), P6 (4.5), P7 (4.6), P8 (4.7), P9 (4.8), P10 (4.9).
- The Metrics_Service is `SELECT`-only and authorization is enforced once at the `/admin` page boundary via `requireAdmin()`, which fails closed with HTTP 404.
- Reminder: creating the Cognito `admins` group is a manual console/deployment step, not a coding task.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "3.1", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 2, "tasks": ["3.2", "3.3", "4.6", "4.7", "4.8", "4.9", "6.1", "8.1"] },
    { "id": 3, "tasks": ["6.2", "7.1", "8.2"] },
    { "id": 4, "tasks": ["8.3"] }
  ]
}
```
