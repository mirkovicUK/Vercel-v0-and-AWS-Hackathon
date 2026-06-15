# Design Document

## Overview

The Admin Dashboard adds an operator-only, read-only metrics view at `/admin`. It is built entirely from existing platform primitives — server components, the Cognito session/guard layer, and the Aurora RDS Data API helpers — and introduces **no new infrastructure** beyond a manually-created Cognito user-pool group named `admins` (a deployment prerequisite, not a code task; see [Deployment Prerequisites](#deployment-prerequisites)).

The feature has four moving parts:

1. **Group-aware claims** — `lib/auth/session.ts` is extended so the verified ID token surfaces its `cognito:groups` claim. This is the single trusted source of admin status.
2. **`requireAdmin()` guard** — a new fail-closed guard in `lib/auth/guard.ts` that mirrors the existing `requireParent`/`requireEntitledParent` shape, but denies with `notFound()` (HTTP 404) rather than a redirect, so the admin area is invisible to non-admins. Denials are audited.
3. **Metrics_Service** — a new read-only module `lib/db/admin-metrics.ts` exposing one typed function per metric group (all `SELECT`-only via the RDS Data API helpers) plus a concurrent aggregator.
4. **Admin page + nav** — a `force-dynamic` server component at `app/(app)/admin/page.tsx` that calls `requireAdmin()` then the aggregator and renders metric cards reusing existing `Card` components, plus a conditional `/admin` link in the app header shown only to admins.

Design principles carried from the existing codebase:

- **Fail closed, server-side only.** Authorization is decided exclusively from the cryptographically verified ID token. No client header, cookie (other than the session tokens), or query parameter is trusted (Req 2.4, 3.x).
- **Aggregate-first PII discipline.** Queries return counts and sums; the only individual records exposed are recent invoices (parent email only) and operational logs (no raw `detail`). No child PII, no `sub`, no `stripe_customer_id`, no question answers ever reach a payload (Req 7.5, 9.4, 12.x).
- **Reuse, don't reinvent.** `getRevenueSummary()` and `formatPrice` are reused as-is; new queries follow the exact `query`/`queryOne` patterns in `lib/db/*`.

## Architecture

```mermaid
flowchart TD
    Browser[Browser request to /admin] --> Page[app/(app)/admin/page.tsx<br/>server component, force-dynamic]
    Page --> Guard["requireAdmin() — lib/auth/guard.ts"]
    Guard --> Claims["getCurrentClaims() — lib/auth/session.ts"]
    Claims --> Verifier[aws-jwt-verify<br/>CognitoJwtVerifier]
    Guard -->|not admin / no session| NotFound["notFound() → HTTP 404"]
    Guard -->|denial| Audit["audit(action: admin.denied)"]
    Guard -->|admin| Page
    Page --> Agg["getAdminMetrics() — lib/db/admin-metrics.ts"]
    Agg -->|Promise.allSettled| Q1[revenue summary]
    Agg --> Q2[recent invoices]
    Agg --> Q3[subscription counts]
    Agg --> Q4[parent/children counts]
    Agg --> Q5[session metrics]
    Agg --> Q6[content metrics]
    Agg --> Q7[operational health]
    Q1 & Q2 & Q3 & Q4 & Q5 & Q6 & Q7 --> RDS["RDS Data API helpers — lib/aws/rds-data.ts (SELECT only)"]
    RDS --> Aurora[(Aurora PostgreSQL)]
    Page --> Cards[Metric cards reusing components/ui/card]
```

### Request flow

1. A request hits `/admin`. The page is `force-dynamic`, so no statically cached metrics are ever served (Req 3.4).
2. The page calls `requireAdmin()` **before** any data fetch. The guard resolves verified claims via the Session_Service; if there is no session or `admins` is absent from the group list, it audits `admin.denied` and calls `notFound()` → HTTP 404 (Req 2.2, 2.3, 2.5, 3.1, 3.3).
3. On success the guard ensures the `parents` row exists (via `getCurrentParent()`) and returns the admin identity.
4. The page calls the aggregator `getAdminMetrics()`, which fires all independent queries concurrently and settles each independently so one failing section does not blank the page (Req 13.3, 14.3).
5. The page renders metric cards. The admin nav link is rendered elsewhere (app header) gated on the same admin check.

### Module map

| Concern | File | Status |
| --- | --- | --- |
| Group-aware claims | `lib/auth/session.ts` | extend `IdClaims`, `getVerifiedClaims`; add `isAdminClaims` |
| Admin guard | `lib/auth/guard.ts` | add `requireAdmin()` |
| Metrics service | `lib/db/admin-metrics.ts` | new |
| Admin page | `app/(app)/admin/page.tsx` | new |
| Metric card components | `components/app/admin/*` | new (reuse `components/ui/card`) |
| Admin nav link | `components/app/app-header.tsx` | extend (conditional link) |
| Audit action | `lib/db/audit.ts` | add `admin.denied`, `admin.viewed` to `AuditAction` |

## Components and Interfaces

### 1. Session_Service (`lib/auth/session.ts`)

The `IdClaims` interface gains a `groups` field. `getVerifiedClaims()` reads `payload["cognito:groups"]` from the **verified** payload (both on the direct-verify path and the refresh path). `aws-jwt-verify` returns this claim as `string[]` when present and `undefined` when absent, so it is normalized to `[]`.

```typescript
export interface IdClaims {
  sub: string
  email: string
  groups: string[]   // NEW — values of the verified cognito:groups claim, [] when absent
}

const ADMIN_GROUP = "admins"

/** Pure predicate: true iff the claims carry membership of the admins group. */
export function isAdminClaims(claims: IdClaims | null): boolean {
  return claims !== null && claims.groups.includes(ADMIN_GROUP)
}
```

A small helper normalizes the raw claim (it can be `string[]`, a single `string`, or `undefined` depending on pool configuration):

```typescript
function readGroups(payload: Record<string, unknown>): string[] {
  const raw = payload["cognito:groups"]
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === "string" && raw.length > 0) return [raw]
  return []
}
```

`sub` and `email` are returned unchanged (Req 1.3). Group membership is derived **only** from the verified payload (Req 1.4) — never from a cookie or header.

> **Token-refresh nuance (documented for operators).** Cognito bakes group membership into the ID token **at sign-in / token issuance**. When a parent is newly added to the `admins` group in the console, their *existing* ID token does not contain the claim. They gain admin access only after the token is refreshed — i.e. after re-login, or once the current ID token expires and `getVerifiedClaims()` transparently refreshes it. Conversely, removing a user from the group only takes full effect after their token rolls over. This is inherent to JWT group claims and is acceptable for v1; it is called out in the deployment notes.

### 2. Admin_Guard (`lib/auth/guard.ts`)

`requireAdmin()` follows the same shape as `requireEntitledParent()` but **fails closed with `notFound()`** instead of redirecting, so unauthorized users cannot distinguish "exists but forbidden" from "does not exist" (Req 2.2, 2.3).

```typescript
import { notFound } from "next/navigation"
import { getCurrentClaims, getCurrentParent, isAdminClaims } from "@/lib/auth/session"

/**
 * Gate for every admin-only surface. Fails CLOSED: any non-admin (including
 * unauthenticated) request is answered with 404 so the admin area is invisible.
 * Returns the admin Parent identity on success.
 */
export async function requireAdmin(): Promise<Parent> {
  const claims = await getCurrentClaims()           // verified ID token claims, or null
  if (!isAdminClaims(claims)) {
    // claims may be null (no session) or lack the admins group — both deny.
    await audit({ action: "admin.denied", parentId: claims?.sub ?? null })
    notFound()                                       // throws → HTTP 404, fail closed
  }
  // Authorized. Ensure the parents row exists and return the identity.
  const parent = await getCurrentParent()
  if (!parent) notFound()                            // defensive: claims valid but no row
  return parent
}
```

Key points:

- Authorization decision uses **only** `getCurrentClaims()` (verified token); no client-supplied identity is read (Req 2.4).
- The audit entry records the denial `action` and the requesting `sub` only — no other PII (Req 2.5). When there is no session, `parentId` is `null`.
- `notFound()` throws, so control never reaches any metric fetch on denial (Req 3.3).
- The success branch reuses `getCurrentParent()`, matching how `requireParent()` guarantees a `parents` row.

### 3. Metrics_Service (`lib/db/admin-metrics.ts`)

A new server-only module. Every function issues **exactly one `SELECT`** via the RDS Data API helpers and returns a typed object. Grouped metrics use `COUNT(*) ... GROUP BY` (Req 13.1); list queries carry explicit `LIMIT`s (Req 13.2). One aggregator runs the independent queries concurrently (Req 13.3).

> Note: the Metrics_Service functions are pure data readers and do **not** call `requireAdmin()` themselves; authorization is enforced once at the page boundary (Req 3.1) and would also be enforced by any future server action that returns admin metrics (Req 3.2). This keeps each query independently testable while the single entry point (`/admin/page.tsx`) guarantees the gate runs first.

Function-by-function SQL (all read-only):

**Revenue overview — reuse existing helper (Req 4.5):**
```typescript
import { getRevenueSummary } from "@/lib/db/revenue"   // returns { totalRevenuePence, payingParentCount, firstPaidAt }
```

**Recent 10 invoices joined to parent email (Req 5.1–5.4):**
```sql
SELECT re.amount_pence, re.currency, re.occurred_at, p.email AS parent_email
FROM revenue_events re
LEFT JOIN parents p ON p.id = re.parent_id      -- LEFT JOIN: null parent_id → null email (unattributed)
ORDER BY re.occurred_at DESC
LIMIT 10
```
A `LEFT JOIN` keeps unattributed invoices (null `parent_id`) and yields `parent_email = null`, which the UI renders as "Unattributed" without inventing an identity (Req 5.4). Only `email` is selected from `parents` — never `sub`/`id` beyond the join key or `stripe_customer_id` (Req 12.2).

**Subscription counts by status + cancel-at-period-end (Req 6.1–6.4):**
```sql
-- grouped counts (single aggregate query)
SELECT status, COUNT(*)::int AS count
FROM subscriptions
GROUP BY status

-- cancel-at-period-end count (single aggregate)
SELECT COUNT(*)::int AS count
FROM subscriptions
WHERE cancel_at_period_end = TRUE
```
The service maps the grouped rows onto all six enum values (`trialing`, `active`, `past_due`, `canceled`, `incomplete`, `unpaid`), defaulting missing statuses to `0` (Req 6.2, 6.3).

**Parent counts — active / soft-deleted / 30-day new (Req 7.1–7.3) and children count (Req 7.4):**
```sql
SELECT
  COUNT(*) FILTER (WHERE deleted_at IS NULL)::int                                   AS active_parents,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int                               AS deleted_parents,
  COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= now() - interval '30 days')::int AS new_parents_30d
FROM parents;

SELECT COUNT(*)::int AS active_children
FROM children
WHERE deleted_at IS NULL;
```
No child columns other than the count are selected (Req 7.5, 12.3).

**Session metrics — total, by status, 30-day, hint usage (Req 8.1–8.3, 8.5):**
```sql
-- totals + windowed + hint sum in one aggregate scan
SELECT
  COUNT(*)::int                                                          AS total_sessions,
  COUNT(*) FILTER (WHERE started_at >= now() - interval '30 days')::int  AS sessions_30d,
  COALESCE(SUM(help_used), 0)::int                                       AS total_help_used
FROM sessions;

-- by status (single aggregate)
SELECT status, COUNT(*)::int AS count
FROM sessions
GROUP BY status;
```
Missing `session_status` values default to `0` in the mapping.

**Review reports by `generated_by` (Req 8.4):**
```sql
SELECT generated_by, COUNT(*)::int AS count
FROM review_reports
GROUP BY generated_by
```
Mapped onto `{ nova, fallback }` defaulting to `0`.

**Content metrics — total, by topic, active/inactive (Req 9.1–9.3):**
```sql
SELECT
  COUNT(*)::int                              AS total_questions,
  COUNT(*) FILTER (WHERE active)::int        AS active_questions,
  COUNT(*) FILTER (WHERE NOT active)::int    AS inactive_questions
FROM questions;

SELECT topic, COUNT(*)::int AS count
FROM questions
GROUP BY topic;
```
`text`, `options`, and `correct_index` are never selected (Req 9.4, 12.4).

**Operational health — recent 10 webhook events, recent 20 audit entries (Req 10.1–10.5):**
```sql
SELECT type, processed_at
FROM processed_webhook_events
ORDER BY processed_at DESC
LIMIT 10;

SELECT action, created_at          -- deliberately NOT selecting detail (Req 10.5)
FROM audit_log
ORDER BY created_at DESC
LIMIT 20;
```
The raw `detail` payload is never selected, so it cannot leak PII (Req 10.5, 12.1).

**Aggregator (Req 13.3, 14.3):**
```typescript
export interface AdminMetrics {
  revenue: SettledSection<RevenueSummary>
  invoices: SettledSection<RecentInvoice[]>
  subscriptions: SettledSection<SubscriptionMetrics>
  users: SettledSection<UserMetrics>
  engagement: SettledSection<EngagementMetrics>
  content: SettledSection<ContentMetrics>
  operations: SettledSection<OperationalMetrics>
}

// Each section either resolves with data or carries an error flag so the page
// renders the rest even if one query fails (Req 14.3).
export type SettledSection<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export async function getAdminMetrics(): Promise<AdminMetrics> {
  const [revenue, invoices, subscriptions, users, engagement, content, operations] =
    await Promise.allSettled([
      getRevenueSummary(),
      getRecentInvoices(),
      getSubscriptionMetrics(),
      getUserMetrics(),
      getEngagementMetrics(),
      getContentMetrics(),
      getOperationalMetrics(),
    ])
  return {
    revenue: settle(revenue),
    invoices: settle(invoices),
    /* ...one per section... */
  }
}

function settle<T>(r: PromiseSettledResult<T>): SettledSection<T> {
  return r.status === "fulfilled"
    ? { ok: true, data: r.value }
    : { ok: false, error: "Failed to load this section." }
}
```

`Promise.allSettled` (rather than `Promise.all`) is what delivers per-section resilience: a rejected query becomes `{ ok: false }` for that section only, and every other section still renders (Req 14.3). The independent queries still run concurrently (Req 13.3).

### 4. Admin page (`app/(app)/admin/page.tsx`)

```typescript
export const dynamic = "force-dynamic"   // never serve cached metrics (Req 3.4)

export default async function AdminPage() {
  await requireAdmin()                    // gate BEFORE any data fetch (Req 3.1)
  const metrics = await getAdminMetrics()
  return (/* metric cards, each reading metrics.<section> */)
}
```

The page lives under the `(app)` route group so it inherits the existing `AppHeader` chrome from `app/(app)/layout.tsx`. It calls `requireAdmin()` first; the layout's `requireParent()` runs earlier but only guarantees a signed-in parent — the admin gate is what enforces 404 for non-admins.

### 5. Metric card components (`components/app/admin/*`)

Presentational server components mirroring `child-progress-card.tsx`, built on `components/ui/card` (`Card`, `CardContent`). Each section card accepts a `SettledSection<T>` and renders either the metric or an inline error state (Req 14.3):

- `RevenueCard`, `RecentInvoicesCard`, `SubscriptionsCard`, `UsersCard`, `EngagementCard`, `ContentCard`, `OperationsCard`.
- A shared `SectionCard` wrapper renders a title and, when `section.ok === false`, an error indicator (e.g. an `AlertCircle` with "Couldn't load this section") instead of the body.
- Currency is formatted with `formatPrice(pence)` from `lib/plans.ts` (Req 4.1, 5.2). Dates are formatted with the same `Intl`/locale approach used elsewhere in the app.
- Empty states (e.g. no invoices) reuse the `Empty*` components already used on the dashboard (Req 5.5).

### 6. Admin nav entry point (`components/app/app-header.tsx`)

The header already imports a `ShieldCheck` icon and renders nav. The admin link is added conditionally: the `(app)` layout computes admin status once and passes it to the header.

- In `app/(app)/layout.tsx`, alongside `requireParent()`, compute `isAdmin` via `isAdminClaims(await getCurrentClaims())` and pass `isAdmin` to `<AppHeader email={parent.email} isAdmin={isAdmin} />`.
- `AppHeader` renders an `/admin` link (a ghost `Button` + `DropdownMenuItem`, matching the existing Dashboard/Billing entries) **only when `isAdmin` is true** (Req 14.1). When false, no link is rendered (Req 14.2).

This keeps the visibility decision on the same trusted server-side signal as the guard; the link is a convenience, and `requireAdmin()` remains the actual enforcement.

## Data Models

All types are server-side TypeScript interfaces in `lib/db/admin-metrics.ts` (plus the extended `IdClaims` in `lib/auth/session.ts`). They are intentionally aggregate and PII-minimal.

```typescript
// --- session.ts (extended) ---
export interface IdClaims {
  sub: string
  email: string
  groups: string[]
}

// --- admin-metrics.ts ---
import type { RevenueSummary } from "@/lib/db/revenue"
import type { SubscriptionStatus, SessionStatus, Topic } from "@/lib/domain"

export interface RecentInvoice {
  amountPence: number
  currency: string
  occurredAt: string
  parentEmail: string | null    // null = unattributed invoice (Req 5.4)
}

export interface SubscriptionMetrics {
  byStatus: Record<SubscriptionStatus, number>   // all six keys present, 0 when absent (Req 6.2, 6.3)
  cancelAtPeriodEnd: number
}

export interface UserMetrics {
  activeParents: number
  deletedParents: number
  newParents30d: number
  activeChildren: number
}

export interface EngagementMetrics {
  totalSessions: number
  byStatus: Record<SessionStatus, number>        // all four keys present, 0 when absent
  sessions30d: number
  totalHelpUsed: number
  reviewReportsByGenerator: { nova: number; fallback: number }
}

export interface ContentMetrics {
  totalQuestions: number
  activeQuestions: number
  inactiveQuestions: number
  byTopic: Record<Topic, number>                 // all topics present, 0 when absent
}

export interface ProcessedWebhookEvent {
  type: string
  processedAt: string
}

export interface AuditEntry {
  action: string
  createdAt: string
  // NOTE: no `detail` field — never selected from the DB (Req 10.5)
}

export interface OperationalMetrics {
  recentWebhookEvents: ProcessedWebhookEvent[]   // ≤ 10
  recentAuditEntries: AuditEntry[]               // ≤ 20
}
```

**PII firewall by construction.** None of these types contain a child field, a Cognito `sub`, a `stripe_customer_id`, a question `text`/`options`/`correct_index`, or an audit `detail`. The only individual-record PII anywhere is `RecentInvoice.parentEmail` (Req 12.2). Because the payload types literally have no field for forbidden data, leakage is prevented at the type level, not just by query discipline.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

These properties are derived from the prework analysis. Most acceptance criteria collapse into a small set of universally-quantified properties: the authorization decision, the grouped-count mapping shape, the PII firewall, and list bounds. The remaining criteria are best served by example/edge tests or are structural constraints verified by review (see [Testing Strategy](#testing-strategy)). Each property below targets pure logic that is extracted from the I/O layer so it can be tested deterministically with mocks/in-memory models.

### Property 1: Group claim normalization

*For any* verified token payload whose `cognito:groups` claim is a list of strings, a single string, or absent, `readGroups` SHALL return a `string[]` that is exactly that list (single string → one-element list, absent/undefined → empty list), and SHALL never return a non-array.

**Validates: Requirements 1.1, 1.2**

### Property 2: Admin access allowed iff `admins` in verified groups

*For any* `IdClaims` value (including `null`), `requireAdmin()` SHALL authorize and return an identity if and only if the claims are non-null and their `groups` list contains `admins`; in every other case (null claims, or a groups list without `admins`) it SHALL deny by throwing the not-found signal, and SHALL NOT invoke or return any admin metric. (Tested via the pure predicate `isAdminClaims` and an injected `notFound`/`getCurrentParent`.)

**Validates: Requirements 2.1, 2.2, 2.3, 3.3**

### Property 3: Denials are audited with the requesting sub only

*For any* non-admin `IdClaims` value (null or lacking `admins`), when `requireAdmin()` denies, it SHALL record exactly one audit entry whose action is `admin.denied` and whose `parentId` equals the claims' `sub` when present or `null` when there is no session, and SHALL include no other PII.

**Validates: Requirements 2.5**

### Property 4: Grouped counts are complete and sum to the total

*For any* multiset of grouped `(key, count)` rows produced by a `GROUP BY` aggregate (over subscription status, session status, review-report generator, or question topic), the mapping into a keyed record SHALL contain every expected key for that domain (missing keys defaulting to `0`), SHALL never produce a negative count, and the sum of all mapped counts SHALL equal the total number of underlying rows.

**Validates: Requirements 6.1, 6.2, 6.3, 8.2, 8.4, 9.2**

### Property 5: Count decompositions partition the total

*For any* set of parent rows, `activeParents + deletedParents` SHALL equal the total parent count; and *for any* set of question rows, `activeQuestions + inactiveQuestions` SHALL equal the total question count.

**Validates: Requirements 7.1, 7.2, 9.3**

### Property 6: 30-day window classification is correct

*For any* set of timestamped rows and any reference instant `now`, the trailing-30-day count SHALL equal the number of qualifying rows whose timestamp is within `[now − 30 days, now]` (for parents, additionally requiring `deleted_at IS NULL`), with rows exactly on the boundary included and future-dated rows excluded.

**Validates: Requirements 7.3, 8.3**

### Property 7: PII firewall over every admin payload

*For any* metrics payload returned by the Metrics_Service, the serialized payload SHALL NOT contain any child field (display name, year group), any Cognito `sub`, any `stripe_customer_id`, any question `text`, `options`, or `correct_index`, or any audit-log `detail`; the only individual-record personal field permitted anywhere SHALL be a recent invoice's `parentEmail`, which SHALL be `null` for an unattributed (null `parent_id`) invoice rather than a fabricated identity.

**Validates: Requirements 5.3, 5.4, 7.5, 9.4, 10.5, 12.1, 12.2, 12.3, 12.4**

### Property 8: List queries are bounded and ordered

*For any* result set returned by a list query (recent invoices, recent webhook events, recent audit entries), the number of returned items SHALL never exceed the query's declared bound (10, 10, and 20 respectively), and the items SHALL be ordered by their timestamp descending.

**Validates: Requirements 5.1, 10.1, 10.3, 13.2**

### Property 9: Metrics_Service issues only read statements

*For any* SQL statement issued by the Metrics_Service, the statement SHALL be a read-only `SELECT` (its first keyword is `SELECT`) and SHALL contain no `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, or other data-mutating keyword.

**Validates: Requirements 11.1, 11.2**

### Property 10: Per-section failure isolation

*For any* assignment of success/failure outcomes to the independent section queries, `getAdminMetrics()` SHALL resolve (never reject) with a result that marks exactly the failed sections as `{ ok: false }` and every other section as `{ ok: true, data }`, so a failure in one section never suppresses the others.

**Validates: Requirements 14.3**

## Error Handling

| Condition | Handling | Requirement |
| --- | --- | --- |
| No session / not an admin at `/admin` | `requireAdmin()` calls `notFound()` → Next.js renders the 404 page; no metric fetch runs | 2.2, 2.3, 3.3 |
| Token expired but refresh token valid | `getVerifiedClaims()` transparently refreshes and re-verifies (existing behavior); groups reflect the refreshed token | 1.1 |
| Newly-granted admin still on an old token | Access denied until token refresh / re-login (documented nuance); not an error state | 1.4 |
| A single metric query throws | `Promise.allSettled` captures the rejection; that section renders an inline error indicator, others render normally | 13.3, 14.3 |
| Empty result sets (no invoices / no events) | Mappers return empty arrays / zeroed records; UI shows empty-state messaging | 4.4, 5.5, 6.3 |
| Aurora not configured (`isAuroraConfigured()` false) | The underlying helpers throw; surfaced as per-section errors via `allSettled`, page still renders shell | 14.3 |
| Audit write fails during denial | `audit()` already swallows its own errors (never throws); denial still returns 404 | 2.5 |

Notably, denial is implemented by **throwing** (`notFound()`), which structurally guarantees no metric values are computed or returned on the deny path (Req 3.3) — there is no code path where a non-admin reaches `getAdminMetrics()`.

## Testing Strategy

This feature uses the project's existing stack: **Vitest** + **fast-check** for property-based tests (see `app/(app)/billing/actions.test.ts` for the established pattern), no new heavy dependencies.

### Test design: extract pure logic

To make the properties testable without a live database or real Cognito tokens, the implementation extracts pure helpers that the property tests target directly:

- `readGroups(payload)` and `isAdminClaims(claims)` — pure, in `session.ts`.
- `requireAdmin()` is structured to take its dependencies (`getCurrentClaims`, `getCurrentParent`, `audit`, `notFound`) such that the decision logic can be exercised with injected spies/mocks (or via a small extracted `decideAdminAccess(claims)` pure core that the test drives, with `requireAdmin` as the thin I/O wrapper).
- Row-mapping/aggregation helpers (`mapGroupedCounts`, `mapInvoiceRow`, `classifyWithin30Days`, the `settle`/aggregator combinator) are pure functions over already-fetched rows, so properties run in-memory.
- A `SELECT`-only check runs against the literal SQL strings the service is built from (exposed as constants or captured via a mock `query`), asserting each matches `/^\s*SELECT/i` and contains no write keyword.

### Property-based tests (fast-check, minimum 100 iterations each)

Each correctness property maps to a **single** property-based test, tagged with the feature and property text:

```
// Feature: admin-dashboard, Property 2: Admin access allowed iff 'admins' in verified groups
// Validates: Requirements 2.1, 2.2, 2.3, 3.3
```

| Test | Generators | Assertion |
| --- | --- | --- |
| P1 groups normalization | payloads with `cognito:groups` as `string[]` / single string / absent | result is always `string[]` matching the claim |
| P2 allow-iff-admin | `null` or claims with random groups (sometimes incl. `admins`) | authorizes iff non-null and includes `admins`; else denies, aggregator never called |
| P3 audit-on-denial | non-admin claims (null or no `admins`) | audit spy called once with `admin.denied` and `parentId = sub ?? null` |
| P4 grouped counts | random `(key, count)` row multisets across each domain | all keys present, none negative, sum == total |
| P5 count decomposition | random parent/question row sets | active + (deleted\|inactive) == total |
| P6 30-day window | random timestamped rows + random `now` | count matches in-memory `[now−30d, now]` filter (boundary inclusive) |
| P7 PII firewall | random metrics payloads built from random rows | serialized payload has no forbidden field; only `parentEmail` permitted; null when unattributed |
| P8 list bounds | random oversized datasets | mapped list length ≤ bound; ordered desc by timestamp |
| P9 SELECT-only | the service's SQL strings | each starts with `SELECT`, no write keyword |
| P10 resilience | random success/failure vector over sections | aggregator resolves; exactly failed sections `ok:false`, rest `ok:true` |

fast-check config mirrors the existing test (`{ numRuns: 200 }` ≥ the 100 minimum).

### Example / edge-case unit tests (Vitest)

- Revenue card renders `formatPrice(totalRevenuePence)`, paying-parent count, and first-paid date; zero summary renders `£0.00` and `0` (Req 4.1–4.4).
- Invoice mapper: null `parent_id` row → `parentEmail: null` rendered as "Unattributed" (Req 5.4); empty list → empty-state (Req 5.5).
- `cancel_at_period_end` count query maps to a single number (Req 6.4).
- `totalHelpUsed` is `0` for an empty sessions table (COALESCE) (Req 8.5).
- Claim mapping passes `sub`/`email` through unchanged with `groups` added (Req 1.3).
- App header renders the `/admin` link when `isAdmin` is true and omits it when false (Req 14.1, 14.2).

### Structural / smoke checks (review or lightweight assertions)

- `app/(app)/admin/page.tsx` exports `dynamic = "force-dynamic"` and calls `requireAdmin()` before `getAdminMetrics()` (Req 3.1, 3.4).
- Each grouped metric is computed with a single aggregate query; `getAdminMetrics()` uses `Promise.allSettled` over independent queries (Req 13.1, 13.3).
- Group membership is read only from the verified payload; `requireAdmin()` reads only `getCurrentClaims()` (no headers/cookies/query) (Req 1.4, 2.4).
- No admin UI control performs writes (Req 11.3).

### Why not property-test everything

Token verification (`aws-jwt-verify`) and the RDS Data API are external dependencies — exercising them belongs in a thin integration/smoke layer, not 100-iteration property loops. Currency formatting (`formatPrice`) and the existing `getRevenueSummary()` are already covered by their owning modules and are reused, not reimplemented.

## Deployment Prerequisites

These are **operational setup steps**, not code tasks:

1. **Create the Cognito group.** In the Cognito console for the app's user pool, create a group named exactly `admins`. This is the sole source of admin authorization (Req glossary: Admins_Group). No code or infrastructure change is required.
2. **Add operators to the group.** Add each admin parent's user to the `admins` group.
3. **Token refresh expectation.** Communicate that newly-added admins must sign out and back in (or wait for token refresh) before the `/admin` link and route become available, because group membership is carried in the ID token issued at sign-in (see the token-refresh nuance above).

No new tables, columns, enums, IAM changes, or third-party dependencies are introduced by this feature.
