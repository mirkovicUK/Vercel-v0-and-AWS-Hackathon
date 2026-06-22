# Implementation Plan: At-Risk Learner Insights

## Overview

This plan converts the At-Risk Learner Insights design into incremental, code-only steps for the
existing Next.js (App Router) + TypeScript codebase. The feature extends the already-shipped Admin
Dashboard at `/admin` with two operator-only, read-only lifecycle cohorts (declining mastery and
trials ending soon) and introduces **no new infrastructure and no new authorization path**.

Work flows from the new server-only `lib/db/at-risk.ts` module (constants, payload types, and pure
helpers), outward to its two `SELECT`-only cohort query functions, then folds those queries into the
existing `getAdminMetrics()` aggregator so they run concurrently and inherit per-section resilience,
and finally renders two new cards inside the existing `MetricAccordion`. Each step builds on the
previous one and ends with the pieces wired together so there is no orphaned code.

The feature reuses existing platform patterns, unchanged: the `requireAdmin()` guard
(`lib/auth/guard.ts`, fail-closed HTTP 404), the `SELECT`-only RDS Data API helpers
(`query`/`queryOne` from `lib/aws/rds-data.ts`), the `SettledSection<T>` wrapper and `settle()`
combinator in `lib/db/admin-metrics.ts`, the `MetricSection`/`MetricAccordion` shell and
`StatGrid`/`StatTile`/`StatChip`/`SubHeading` presentational helpers in `components/app/admin/`, and
Vitest + fast-check property tests mirroring `app/(app)/billing/actions.test.ts`.

> **REUSED, NON-CODE PREREQUISITE (not an implementation task):** Admin access is governed by the
> existing Cognito `admins` group and `requireAdmin()` guard shipped with the admin-dashboard spec.
> No new auth setup is introduced. The documented PII exception (parent email + child display name
> for this surface only) is encoded structurally in the payload types — there is no console/config
> step to perform.

## Tasks

- [x] 1. Create the Insights_Service foundation: constants, types, and pure helpers
  - [x] 1.1 Implement `lib/db/at-risk.ts` constants, row/item types, and pure helpers
    - Create `lib/db/at-risk.ts` with `import "server-only"` and `import { query } from "@/lib/aws/rds-data"`.
    - Define the tunable named constants: `MASTERY_TREND_WINDOW = 5`, `MIN_COMPLETED_SESSIONS = 2`, `TRIAL_ENDING_WINDOW_DAYS = 3`, `COHORT_ROW_LIMIT = 50`.
    - Define the raw DB-row types `DecliningMasteryRow` (`child_display_name`, `parent_email`, `mastery_slope`) and `TrialEndingRow` (`parent_email`, `trial_end`), and the payload item types `DecliningMasteryItem` (`childDisplayName`, `parentEmail`, `masterySlope`) and `TrialEndingItem` (`parentEmail`, `daysRemaining`, `trialEnd`) — with no field for any forbidden attribute (the type-level PII firewall).
    - Implement the pure, I/O-free helpers: `recentMasterySlope(series)` (last − first, `null` for empty), `qualifiesAsDecliningMastery(slope, count, min)`, `formatSignedSlope(n)`, `inTrialEndingWindow(status, trialEnd, now, windowDays)`, `computeDaysRemaining(trialEnd, now)`, `mapDecliningMasteryRow(row)`, and `mapTrialEndingRow(row, now)`.
    - Implement a pure ordering/bound helper `orderAndLimit(rows, compare, limit)` plus the two comparators mirroring the SQL `ORDER BY` (declining: `masterySlope` asc then unique tie-break; trials: `trialEnd` asc then unique tie-break) so the ordering property is testable in-memory.
    - _Requirements: 2.2, 2.3, 2.4, 3.3, 4.2, 4.3, 5.2, 8.3_

  - [ ]* 1.2 Write property test for recent mastery slope reduction
    - In a new `lib/db/at-risk.test.ts`, tag `// Feature: at-risk-learner-insights, Property 1: Recent mastery slope is the net signed change across the window`.
    - Generate random numeric series (including empty, length 1, and negatives); assert `recentMasterySlope(series)` equals `last − first`, equals the sum of consecutive deltas (telescoping), and is `null` for an empty series.
    - Use fast-check with `{ numRuns: 200 }`.
    - **Property 1: Recent mastery slope is the net signed change across the window**
    - **Validates: Requirements 2.2, 8.1**

  - [ ]* 1.3 Write property test for declining-mastery classification
    - Tag `// Feature: at-risk-learner-insights, Property 2: Declining-mastery classification`.
    - Generate a random slope (including `null`, 0, positive, negative), a random non-negative completed-session count, and a random minimum threshold; assert `qualifiesAsDecliningMastery` returns true iff slope is non-null AND strictly negative AND count ≥ threshold, and false in every other case.
    - fast-check `{ numRuns: 200 }`.
    - **Property 2: Declining-mastery classification**
    - **Validates: Requirements 2.3, 2.4**

  - [ ]* 1.4 Write property test for signed slope formatting
    - Tag `// Feature: at-risk-learner-insights, Property 3: Slope is formatted with an explicit leading sign`.
    - Generate random integers/floats (including 0 and both signs); assert `formatSignedSlope(n)` carries an explicit leading sign (`+` for positive, `-` for negative, `"0"` for zero) and that `Number(parse(formatted)) === n`.
    - fast-check `{ numRuns: 200 }`.
    - **Property 3: Slope is formatted with an explicit leading sign**
    - **Validates: Requirements 3.3**

  - [ ]* 1.5 Write property test for trial-ending-window membership
    - Tag `// Feature: at-risk-learner-insights, Property 4: Trial-ending-window membership`.
    - Generate a random status, a random `trialEnd` clustered around `now`, `now`, `now + N` and the exact boundaries, a single reference `now`, and a random window `N`; assert `inTrialEndingWindow` returns true iff status is `trialing` AND `now <= trialEnd <= now + N days` (both bounds inclusive), boundaries included, past trials excluded.
    - fast-check `{ numRuns: 200 }`.
    - **Property 4: Trial-ending-window membership**
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 1.6 Write property test for days-remaining
    - Tag `// Feature: at-risk-learner-insights, Property 5: Days-remaining is a rounded-up, non-negative whole number`.
    - Generate random `trialEnd`/`now` pairs (past, fractional-day, exact-day); assert `computeDaysRemaining(trialEnd, now)` equals `max(0, ceil((trialEnd − now) / one day))`, is an integer, and is never negative.
    - fast-check `{ numRuns: 200 }`.
    - **Property 5: Days-remaining is a rounded-up, non-negative whole number**
    - **Validates: Requirements 5.2**

  - [ ]* 1.7 Write property test for cohort ordering and bound
    - Tag `// Feature: at-risk-learner-insights, Property 6: Cohort ordering and bound`.
    - Generate random oversized candidate row sets and a random positive limit for each cohort's comparator; assert the `orderAndLimit` result contains no more than `limit` rows, is sorted non-decreasing by the primary key with a total deterministic tie-break (identical inputs yield identical order), and the retained rows are exactly the smallest `limit` rows under that order (steepest declines / soonest-ending kept).
    - fast-check `{ numRuns: 200 }`.
    - **Property 6: Cohort ordering and bound**
    - **Validates: Requirements 2.5, 2.6, 4.4, 4.5, 8.3, 8.4**

  - [ ]* 1.8 Write property test for the PII firewall over cohort payloads
    - Tag `// Feature: at-risk-learner-insights, Property 7: PII firewall over every cohort payload`.
    - Generate random `DecliningMasteryRow`/`TrialEndingRow` inputs, map them via `mapDecliningMasteryRow`/`mapTrialEndingRow`, and assert the serialized payload's keys are a subset of `{ childDisplayName, parentEmail, masterySlope }` and `{ parentEmail, daysRemaining, trialEnd }` respectively — never any Cognito `sub`, `stripe_customer_id`, other child/parent attribute, or question `text`/`options`/`correct_index`.
    - fast-check `{ numRuns: 200 }`.
    - **Property 7: PII firewall over every cohort payload**
    - **Validates: Requirements 3.5, 3.6, 5.4, 5.5, 7.1, 7.2, 7.3, 7.4, 7.5**

- [x] 2. Implement the SELECT-only cohort query functions
  - [x] 2.1 Add the cohort SQL constants and query functions to `lib/db/at-risk.ts`
    - Add the `COMPLETED` predicate matching `lib/db/analytics.ts` so the cohort reuses the same relational definition of a completed session.
    - Export `DECLINING_MASTERY_SQL` as a named string constant using the exact window query from the design (the `per_session` → `recent` → `windowed` → `slope` CTE chain, joins to `children`/`parents`, `window_session_count >= :minSessions`, `mastery_slope < 0`, `ORDER BY mastery_slope ASC, display_name ASC, id ASC`, `LIMIT :limit`), selecting only `child_display_name`, `parent_email`, `mastery_slope`.
    - Export `TRIALS_ENDING_SQL` as a named string constant using the exact `subscriptions JOIN parents` query from the design (`status = 'trialing'`, `trial_end >= :now`, `trial_end <= :now + make_interval(days => :windowDays)`, `ORDER BY trial_end ASC, email ASC, id ASC`, `LIMIT :limit`), selecting only `parent_email`, `trial_end`.
    - Implement `getDecliningMasteryCohort(): Promise<DecliningMasteryItem[]>` calling `query<DecliningMasteryRow>(DECLINING_MASTERY_SQL, { window: MASTERY_TREND_WINDOW, minSessions: MIN_COMPLETED_SESSIONS, limit: COHORT_ROW_LIMIT })` and mapping rows via `mapDecliningMasteryRow`.
    - Implement `getTrialsEndingSoon(now: Date = new Date()): Promise<TrialEndingItem[]>` binding the single constant `now`, calling `query<TrialEndingRow>(TRIALS_ENDING_SQL, { now, windowDays: TRIAL_ENDING_WINDOW_DAYS, limit: COHORT_ROW_LIMIT })`, and mapping rows via `mapTrialEndingRow(row, now)`.
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 8.1, 8.2, 8.3, 8.4_

  - [ ]* 2.2 Write property test for SELECT-only statements
    - In `lib/db/at-risk.test.ts`, tag `// Feature: at-risk-learner-insights, Property 8: Insights_Service issues only read statements`.
    - Assert each of `DECLINING_MASTERY_SQL` and `TRIALS_ENDING_SQL` matches `/^\s*(WITH|SELECT)\b/i` and contains no `INSERT`/`UPDATE`/`DELETE`/`MERGE`/`UPSERT`/`ALTER`/`DROP`/`CREATE`/`TRUNCATE` or other data-mutating/DDL keyword.
    - fast-check `{ numRuns: 200 }` (e.g. over the set of forbidden keywords / SQL constants).
    - **Property 8: Insights_Service issues only read statements**
    - **Validates: Requirements 6.1, 8.2**

- [x] 3. Fold the two cohorts into the existing aggregator
  - [x] 3.1 Extend `AdminMetrics` and `getAdminMetrics()` in `lib/db/admin-metrics.ts`
    - Import `getDecliningMasteryCohort`, `getTrialsEndingSoon` and the `DecliningMasteryItem`, `TrialEndingItem` types from `@/lib/db/at-risk`.
    - Add `decliningMastery: SettledSection<DecliningMasteryItem[]>` and `trialsEndingSoon: SettledSection<TrialEndingItem[]>` to the `AdminMetrics` interface.
    - Add `getDecliningMasteryCohort()` and `getTrialsEndingSoon()` as two new entries in the existing `Promise.allSettled` array so they dispatch in the same batch as the seven existing metric queries (concurrent, never awaiting them), and map both results with the existing `settle()` combinator. Make no other change to the aggregator.
    - _Requirements: 6.5, 8.5, 9.2, 9.3_

  - [ ]* 3.2 Write property test for per-section failure isolation across cohorts
    - In `lib/db/admin-metrics.test.ts` (extending the existing resilience test), tag `// Feature: at-risk-learner-insights, Property 9: Per-section failure isolation`.
    - Generate a random success/failure vector over all nine sections (seven existing + the two cohorts); assert `getAdminMetrics()` always resolves (never rejects) and marks exactly the failed sections `{ ok: false }` and every other section `{ ok: true, data }`, so a failure in one cohort never blanks another cohort or any existing metric section.
    - fast-check `{ numRuns: 200 }`.
    - **Property 9: Per-section failure isolation**
    - **Validates: Requirements 9.2, 9.3**

- [x] 4. Checkpoint - service, queries, and aggregator
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Build the cohort cards
  - [x] 5.1 Implement and export the two cohort cards
    - Create `components/app/admin/declining-mastery-card.tsx` (accent `rose`): a presentational server component accepting `section: SettledSection<DecliningMasteryItem[]>`, passing `hasError={!section.ok}` to `MetricSection`, rendering one row per item (up to the limit) in service order with `childDisplayName`, the owning `parentEmail`, and the slope via `formatSignedSlope(masterySlope)` using `StatGrid`/`StatTile`/`StatChip`/`SubHeading` and a header `preview` count; empty state when `section.ok && data.length === 0`: "No children currently show a declining mastery trend."
    - Create `components/app/admin/trials-ending-card.tsx` (accent `amber`): the same shape accepting `section: SettledSection<TrialEndingItem[]>`, rendering one row per member in service order (soonest-ending first) with `parentEmail` and a `daysRemaining` label (e.g. "2 days left"); empty state: "No trials are ending in the next 3 days."
    - Export both components from `components/app/admin/index.ts`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.2, 6.3, 6.4, 7.1, 7.3, 9.1, 9.2_

  - [ ]* 5.2 Write unit tests for the cohort cards
    - `DecliningMasteryCard` renders one row per item with `childDisplayName`, `parentEmail`, and `formatSignedSlope(masterySlope)`, preserving service order; empty data renders the "no declining mastery trend" empty state; a `section` with `ok: false` renders the `MetricSection` error indicator.
    - `TrialsEndingCard` renders `parentEmail` and a days-remaining label per member, soonest-ending first; empty data renders the "no trials ending in the next 3 days" empty state; a `section` with `ok: false` renders the error indicator.
    - _Requirements: 3.1, 3.2, 3.4, 3.7, 5.1, 5.3, 5.6, 9.2_

- [x] 6. Wire the cards into the admin page
  - [x] 6.1 Render the two cohort cards in `app/(app)/admin/page.tsx`
    - Inside the existing `MetricAccordion` (keeping the unchanged `force-dynamic` + `requireAdmin()`-before-`getAdminMetrics()` flow), render `<DecliningMasteryCard section={metrics.decliningMastery} />` and `<TrialsEndingCard section={metrics.trialsEndingSoon} />` grouped after the existing operational metric cards.
    - _Requirements: 1.1, 1.6, 9.1, 9.4_

- [x] 7. Final checkpoint - full feature wired together
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks (the non-`*` ones) are never optional.
- Each task references specific granular requirements clauses for traceability.
- Property tests use fast-check with `{ numRuns: 200 }` (≥ the 100-iteration minimum) and mirror the established pattern in `app/(app)/billing/actions.test.ts`, including the `// Feature: at-risk-learner-insights, Property N: ...` tag.
- All 9 correctness properties from the design are covered: P1 (1.2), P2 (1.3), P3 (1.4), P4 (1.5), P5 (1.6), P6 (1.7), P7 (1.8), P8 (2.2), P9 (3.2).
- The Insights_Service (`lib/db/at-risk.ts`) is `SELECT`-only; authorization is enforced once at the `/admin` page boundary via the reused `requireAdmin()` guard (fail-closed HTTP 404), so no cohort task re-implements auth.
- The PII firewall is structural: the `DecliningMasteryItem`/`TrialEndingItem` types have no slot for any forbidden field, confining the documented exception to this surface only.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"] },
    { "id": 2, "tasks": ["2.2", "3.1", "5.1"] },
    { "id": 3, "tasks": ["3.2", "5.2", "6.1"] }
  ]
}
```
