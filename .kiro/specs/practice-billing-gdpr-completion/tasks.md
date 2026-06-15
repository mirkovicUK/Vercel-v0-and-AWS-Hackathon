# Implementation Plan: practice-billing-gdpr-completion

## Overview

This plan completes ApexMaths against the Aurora/Cognito/Stripe/Bedrock stack (Next.js 16 App Router, Vercel serverless) in dependency order. Language is **TypeScript** throughout (the design specifies concrete TS interfaces; no pseudocode).

Work proceeds:

1. **Test tooling + schema migration** — install Vitest + fast-check (no test framework exists yet), then add `scripts/sql/005_completion.sql` applied via `scripts/migrate.mjs`.
2. **Cross-cutting B (domain)** first because Tier 2 summaries, progress, and the add-child UI all depend on it.
3. **Tier 1** trial-abuse + one-active-session guard.
4. **Tier 2** synchronous per-session AI review (marquee).
5. **Tier 3** revenue tracking from `invoice.paid` + webhook idempotency.
6. **Tier 4** GDPR hard-delete (incl. one flagged infra task for the IAM change).
7. **Cross-cutting A** embedded checkout.

Property-based tests use **fast-check** (Vitest runner), minimum 100 iterations, and each is tagged:
`// Feature: practice-billing-gdpr-completion, Property {N}: {property_text}`

Sub-tasks marked `*` are optional (tests) and are not auto-implemented.

## Tasks

- [x] 1. Test tooling and schema migration foundation
  - [x] 1.1 Set up Vitest + fast-check test tooling
    - Add `vitest`, `fast-check`, `@vitest/coverage-v8` to `devDependencies` in `package.json`
    - Add scripts: `"test": "vitest --run"` and `"test:watch": "vitest"`
    - Create `vitest.config.ts` (node environment, `globals: true`, include `**/*.test.ts`)
    - Add a trivial `lib/domain.test.ts` smoke test to confirm the runner executes
    - _Requirements: Testing Strategy (fast-check + Vitest)_

  - [x] 1.2 Author the schema migration `scripts/sql/005_completion.sql`
    - Add `has_used_trial BOOLEAN NOT NULL DEFAULT FALSE` to `parents` (Req 1.1, 1.3)
    - `ALTER TYPE mastery_classification ADD VALUE IF NOT EXISTS 'insufficient_data'` as its own statement
    - Reconcile out-of-range `children.year_group` then swap CHECK to `year_group IS NULL OR year_group BETWEEN 4 AND 6` (Req 19.4)
    - `CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_session_per_child ON sessions(child_id) WHERE status = 'active'`
    - `CREATE TABLE IF NOT EXISTS revenue_summary (id TEXT PK DEFAULT 'current', total_revenue_pence BIGINT, paying_parent_count INT, first_paid_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`
    - _Requirements: 1.1, 1.3, 4.1, 10.1, 19.4, 20.4_

  - [ ]* 1.3 Write smoke test for the migration artifacts
    - Assert `005_completion.sql` contains `has_used_trial`, `insufficient_data`, the 4..6 CHECK, `uniq_active_session_per_child`, and `revenue_summary`
    - Verify the file is statement-splittable by the `splitSql` logic in `scripts/migrate.mjs` (ALTER TYPE isolated as its own statement)
    - _Requirements: 1.3, 19.4, 20.4_

- [x] 2. Cross-cutting B — domain reconciliation (year groups + mastery)
  - [x] 2.1 Update `lib/domain.ts` constants and `classifyMastery`
    - Add `YEAR_GROUPS = [4, 5, 6] as const` and `YearGroup` type
    - Extend `MASTERY_CLASSIFICATIONS` to include `insufficient_data`; add `MIN_ATTEMPTS_FOR_CLASSIFICATION = 10`
    - Rewrite `classifyMastery(attempts, score)` with precedence: `insufficient_data` < min attempts; `strong` ≥ 0.8; `developing` ≥ 0.5; `needs_focus` otherwise (score is a fraction in [0,1])
    - Add `insufficient_data` to `CLASSIFICATION_LABELS`
    - _Requirements: 19.1, 20.1, 20.2, 20.3, 20.4, 20.5_

  - [ ]* 2.2 Write property test for mastery classification
    - **Property 27: Mastery classification thresholds and precedence**
    - fast-check generators: `attempts` in 0..40, `score` in [0,1] incl. 0.5 / 0.8 boundaries
    - **Validates: Requirements 20.1, 20.2, 20.3, 20.4**
    - File: `lib/domain.test.ts`

  - [x] 2.3 Add pure per-session summary helpers in `lib/domain.ts`
    - `computePerTopicSummary(answers)` → `{ topic, attempted, correct }[]` over graded answers
    - `strongestWeakest(summary)` → `{ strongest, weakest }` by correct/attempted ratio; ties alphabetical by topic key; `weakest = "n/a"` iff < 2 topics have ≥ 1 attempt
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 2.4 Write property test for per-topic summary counts
    - **Property 4: Per-topic summary preserves counts**
    - **Validates: Requirements 5.1**
    - File: `lib/domain.test.ts`

  - [ ]* 2.5 Write property test for strongest/weakest determinism and n/a rule
    - **Property 5: Strongest/weakest determinism and n/a rule**
    - **Validates: Requirements 5.2, 5.3**
    - File: `lib/domain.test.ts`

  - [x] 2.6 Update `lib/db/progress.ts` to use pinned thresholds + min-attempts
    - Update inline SQL `CASE` and the `classifyMastery` call to the `(attempts, fractional score)` signature
    - Write `insufficient_data` when attempts < `MIN_ATTEMPTS_FOR_CLASSIFICATION`
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

  - [x] 2.7 Constrain year group in add-child UI and Zod schema
    - `components/app/add-child-dialog.tsx`: offer only Year 4, 5, 6 options
    - `app/(app)/children/actions.ts`: Zod `yearGroup` accepts only null/absent or integer in {4,5,6}; reject others
    - _Requirements: 19.1, 19.2, 19.3_

  - [ ]* 2.8 Write property test for year-group validation
    - **Property 26: Year group accepted iff in range**
    - fast-check generator: integers in -1..10 plus `null`
    - **Validates: Requirements 19.1, 19.3**
    - File: `app/(app)/children/actions.test.ts`

- [x] 3. Checkpoint — domain layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Tier 1 — trial flag persistence and eligibility decision
  - [x] 4.1 Add trial-flag and hard-delete accessors to `lib/db/parents.ts`
    - Add `has_used_trial` to `ParentRow`; do NOT copy it into the client-facing `Parent` (server-only, Req 1.2)
    - `getHasUsedTrial(parentId)`, `setHasUsedTrial(parentId)` (monotonic latch — only sets TRUE, idempotent), `hardDeleteParent(parentId)` (`DELETE FROM parents WHERE id = :id`)
    - _Requirements: 1.1, 1.2, 1.4, 3.1, 3.2, 3.3, 14.1_

  - [ ]* 4.2 Write property test for trial flag monotonicity
    - **Property 2: Trial flag is monotonic**
    - Test `setHasUsedTrial` over generated operation sequences against an in-memory fake of the query surface
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - File: `lib/db/parents.test.ts`

  - [x] 4.3 Implement `decideTrialEligibility` in `app/(app)/billing/actions.ts`
    - Pure-ish: takes `{ hasUsedTrial, stripeCustomerId, listPriorSubscriptions }` and returns `{ grantTrial, reason }`
    - Implement decision table: flag TRUE → no trial; FALSE + prior sub → no trial; FALSE + 0/no customer → trial; lookup throws → fail-open trial when FALSE
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 18.5_

  - [x]* 4.4 Write property test for trial eligibility decision
    - **Property 1: Trial granted iff eligible**
    - fast-check generator: `{ hasUsedTrial, customerId: string|null, priorCount: 0..3, lookupThrows }`
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 18.5**
    - File: `app/(app)/billing/actions.test.ts`

  - [x] 4.5 Wire trial latch into the Stripe webhook subscription sync
    - In `app/api/stripe/webhook/route.ts` `syncSubscription`, after resolving `parentId`, call `setHasUsedTrial(parentId)` when `sub.status === 'trialing'`
    - Do not write the flag back to FALSE anywhere
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Tier 1 — one-active-session-per-child guard
  - [x] 5.1 Add active-session helpers to `lib/db/sessions.ts`
    - `getActiveSession(childId, parentId)`: status='active' AND now() <= expires_at, calling `expireIfElapsed` so expired rows do not block
    - `endSession(sessionId, parentId)`: move active session to `abandoned`, set `completed_at`, `RETURNING`
    - _Requirements: 4.1, 4.3, 4.4, 4.5_

  - [x] 5.2 Add the active-session guard and `endSessionAction` to `app/(app)/practice/actions.ts`
    - In `startSessionAction`, call `getActiveSession` first; return `{ activeSession: { id, childId } }` if one exists (offer resume/end, Req 4.2)
    - Catch the `uniq_active_session_per_child` unique-violation from `createSession` and surface it as `{ activeSession }` rather than a 500
    - Add `endSessionAction(sessionId)`: `requireEntitledParent` → `endSession` → revalidate
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x]* 5.3 Write property test for one-active-session invariant
    - **Property 3: At most one active session per child**
    - Generate interleavings of start/end/expire against an in-memory fake modelling the partial unique index
    - **Validates: Requirements 4.1, 4.3, 4.4, 4.5**
    - File: `lib/db/sessions.test.ts`

  - [ ]* 5.4 Write example test for the resume/end start response
    - Starting when an active session exists returns the existing session id and resume/end options
    - _Requirements: 4.2_
    - File: `app/(app)/practice/actions.test.ts`

- [ ] 6. Checkpoint — Tier 1
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Tier 2 — review persistence layer
  - [x] 7.1 Create `lib/db/reviews.ts`
    - Define `ReviewStatus`, `ReviewGeneratedBy`, `ReviewItem`, `ReviewDocument` types
    - `upsertReviewReport({ sessionId, document, generatedBy })`: INSERT ... ON CONFLICT (session_id) DO UPDATE (idempotent)
    - `getReviewReport(sessionId)`: returns `{ document, generatedBy } | null`; never exposes `imageDescription`
    - _Requirements: 5.7, 5.8, 7.4_

  - [ ]* 7.2 Write property test for one-report-per-session idempotency
    - **Property 11: Exactly one report per session**
    - Generate repeated upserts for a session id against an in-memory fake of the unique `session_id`
    - **Validates: Requirements 5.7**
    - File: `lib/db/reviews.test.ts`

- [x] 8. Tier 2 — bounded synchronous review orchestrator
  - [x] 8.1 Create `lib/ai/review.ts` Review_Service
    - Define `ReviewItemContext` (PII-free), `ReviewItemResult`, `ReviewServiceConfig` (perCallTimeoutMs=12000, overallBudgetMs=45000, maxConcurrency=30)
    - `fallbackExplanation(item)`: pure deterministic text
    - `generateReviewExplanations(items, config?)`: launch all calls in parallel; per-call `Promise.race` vs timeout; `Promise.allSettled` raced against overall deadline; validate non-empty/well-formed; fallback for any failure/timeout/empty/malformed; never throws
    - Build prompt via injected model (model passed in / defaulted from `lib/ai/model.ts`) so tests can inject a fake `LanguageModel`; reuse the `report-actions.ts` `experimental_output`/zod pattern
    - PII firewall: include only topic, question text, options, correctAnswerText, imageDescription, yearGroup; never names/ids/imageUrl
    - _Requirements: 5.4, 5.5, 5.6, 7.1, 7.2, 7.3, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9_

  - [ ]* 8.2 Write property test for review item count
    - **Property 6: Review item count equals wrong-answer count**
    - **Validates: Requirements 5.4**
    - File: `lib/ai/review.test.ts`

  - [ ]* 8.3 Write property test for zero-incorrect-no-model-call
    - **Property 7: Zero incorrect answers means no model call**
    - Use an injected model spy asserting zero invocations
    - **Validates: Requirements 5.5**
    - File: `lib/ai/review.test.ts`

  - [x]* 8.4 Write property test for total robustness of the orchestrator
    - **Property 8: Review always finalises with text for every item, regardless of the model**
    - Inject model behaviours `{ ok, throw, hang, empty, malformed }` per item plus latency draws
    - **Validates: Requirements 5.6, 8.2, 8.3, 8.4, 8.5, 8.6**
    - File: `lib/ai/review.test.ts`

  - [ ]* 8.5 Write property test for generated_by source attribution
    - **Property 10: `generated_by` reflects the actual source**
    - `nova` iff ≥ 1 validated model item; `fallback` when all items fell back
    - **Validates: Requirements 5.8, 8.9**
    - File: `lib/ai/review.test.ts`

  - [ ]* 8.6 Write property test for the PII firewall on prompts
    - **Property 12: PII firewall on review prompts**
    - Capture the built prompt via the injected model; assert it excludes names/emails/ids/imageUrl
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.5**
    - File: `lib/ai/review.test.ts`

- [x] 9. Tier 2 — finish-session wiring and result rendering
  - [x] 9.1 Rewrite `finishSessionAction` in `app/(app)/practice/actions.ts`
    - Add `export const maxDuration = 60` at top of file (Req 8.7, 8.8)
    - Flow: `completeSession` → `applySessionToProgress` → build deterministic `ReviewDocument` (summary, strongest/weakest, one item per wrong answer w/ fallback) → `upsertReviewReport` **before any AI** (skeleton) → if wrong answers, `generateReviewExplanations`, merge, `upsertReviewReport` with `generatedBy` → revalidate + redirect to result
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 8.7, 8.8_

  - [ ]* 9.2 Write property test for score/summary persisted before AI
    - **Property 9: Score and summary are persisted before any AI work**
    - Inject a model that always throws/hangs; assert score + summary are readable afterward
    - **Validates: Requirements 6.2, 6.3, 6.4**
    - File: `app/(app)/practice/finish-session.test.ts`

  - [ ]* 9.3 Write smoke test for maxDuration and budget ordering
    - Assert `finishSessionAction` file exports `maxDuration = 60` and `60 > 45 + persist time`, `45 < 60`
    - **Validates: Requirements 8.7, 8.8**
    - File: `app/(app)/practice/finish-session.test.ts`

  - [x] 9.4 Render the stored review on the result page
    - `app/(app)/practice/[sessionId]/result/page.tsx`: call `getReviewReport(sessionId)`; render score/summary always; per wrong answer show `explanation` + `nextStep`; show "still finishing" note only if `status === 'pending'`
    - Never read `imageDescription` into the page payload
    - _Requirements: 5.7, 7.4_

  - [ ]* 9.5 Write property test that imageDescription never reaches the client
    - **Property 13: `imageDescription` never reaches the client**
    - **Validates: Requirements 7.4**
    - File: `lib/db/reviews.test.ts`

- [ ] 10. Checkpoint — Tier 2
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Tier 3 — revenue data layer
  - [x] 11.1 Create `lib/db/revenue.ts`
    - `recordRevenueEvent(input)`: single transaction; INSERT revenue_events ON CONFLICT (stripe_invoice_id) DO NOTHING RETURNING id; if duplicate, skip without re-reading amount and don't touch summary; else accumulate into singleton `revenue_summary` (total += amount; paying_parent_count += 1 only when parent had no prior event; first_paid_at set once via COALESCE); returns `{ recorded }`
    - `getRevenueSummary()` → `RevenueSummary`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4_

  - [x]* 11.2 Write property test for idempotent positive-amount recording
    - **Property 14: Revenue recorded iff amount positive and unseen (idempotent)**
    - Generate `invoice.paid` sequences with duplicates and `amount_paid <= 0`
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
    - File: `lib/db/revenue.test.ts`

  - [ ]* 11.3 Write property test for field round-trip
    - **Property 15: Recorded revenue events preserve their fields**
    - **Validates: Requirements 9.5**
    - File: `lib/db/revenue.test.ts`

  - [ ]* 11.4 Write property test for summary total equals sum of events
    - **Property 16: Revenue summary total equals the sum of events**
    - **Validates: Requirements 10.1**
    - File: `lib/db/revenue.test.ts`

  - [ ]* 11.5 Write property test for distinct paying-parent count
    - **Property 17: A paying parent is counted exactly once**
    - **Validates: Requirements 10.2, 10.3**
    - File: `lib/db/revenue.test.ts`

  - [ ]* 11.6 Write property test for first-paid timestamp set once
    - **Property 18: First-paid timestamp is set once**
    - **Validates: Requirements 10.4**
    - File: `lib/db/revenue.test.ts`

- [x] 12. Tier 3 — webhook idempotency and invoice.paid handling
  - [x] 12.1 Add the processed-events idempotency guard to the webhook route
    - `app/api/stripe/webhook/route.ts`: after signature check, check `processed_webhook_events`; if present return 200 without reprocessing; on handler success `markEventProcessed` (INSERT ON CONFLICT DO NOTHING) then 200; on throw return 500 without marking
    - Reject missing/invalid signature with 400
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 12.2 Add the `invoice.paid` handler (revenue only) and register the event
    - Handle `invoice.paid`: when `amount_paid > 0`, resolve parent via `getParentByStripeCustomerId`, call `recordRevenueEvent`; skip when `amount_paid <= 0`
    - Do NOT modify subscription status from invoice events; status changes only via `customer.subscription.created/updated/deleted`
    - Register `invoice.paid` in the route's handled event list
    - _Requirements: 9.1, 9.4, 9.5, 11.1, 11.2_

  - [ ]* 12.3 Write property test for invoice events never changing status
    - **Property 19: Invoice events never change subscription status**
    - **Validates: Requirements 11.1, 11.2**
    - File: `app/api/stripe/webhook/route.test.ts`

  - [ ]* 12.4 Write property test for webhook event idempotency
    - **Property 20: Webhook event idempotency**
    - **Validates: Requirements 12.1, 12.2**
    - File: `app/api/stripe/webhook/route.test.ts`

  - [ ]* 12.5 Write property test for failed-handler leaving no marker
    - **Property 21: A failed handler leaves no suppressing marker**
    - **Validates: Requirements 12.3**
    - File: `app/api/stripe/webhook/route.test.ts`

- [ ] 13. Checkpoint — Tier 3
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Tier 4 — GDPR hard-delete
  - [x] 14.1 Add `adminDeleteUser` to `lib/auth/cognito.ts`
    - `adminDeleteUser(username)` using `AdminDeleteUserCommand({ UserPoolId, Username })`; non-fatal at call site
    - _Requirements: 15.1, 15.2_

  - [x] 14.2 Rewrite `deleteMyAccount` in `app/(app)/account/actions.ts` with fail-closed ordering
    - Confirm: `confirmation.trim().toUpperCase() === "DELETE"` else error, erase nothing
    - Audit first (throwing variant): append-only `parent.deleted` with `{ parentUid, email, stripeCustomerId }`, no child PII; abort on failure
    - Stripe erasure: cancel active/trialing/past_due subs then delete customer; any error aborts intact
    - Aurora: `hardDeleteParent(parent.id)` relying on FK cascade
    - Cognito: `adminDeleteUser(parent.email)` non-fatal
    - Sign out, clear cookies, redirect
    - _Requirements: 13.1, 13.2, 13.3, 14.1, 14.2, 14.3, 15.1, 15.2, 16.1, 16.2, 16.3, 17.1, 17.2, 17.3_

  - [ ]* 14.3 Write property test for deletion confirmation gate
    - **Property 25: Confirmation gate**
    - Generator: `"DELETE"` case/whitespace variants plus arbitrary strings
    - **Validates: Requirements 17.1, 17.2, 17.3**
    - File: `app/(app)/account/actions.test.ts`

  - [ ]* 14.4 Write property test for fail-closed abort on pre-Aurora failure
    - **Property 22: Deletion aborts intact when a pre-Aurora step fails**
    - Inject audit/Stripe failures; assert no Aurora/Cognito deletion and data intact
    - **Validates: Requirements 13.3, 16.2**
    - File: `app/(app)/account/actions.test.ts`

  - [ ]* 14.5 Write property test for audit excluding child PII
    - **Property 24: Deletion audit excludes child PII**
    - **Validates: Requirements 16.1, 16.3**
    - File: `app/(app)/account/actions.test.ts`

  - [ ]* 14.6 Write property test for hard-delete leaving no residue
    - **Property 23: Hard-delete leaves no residue**
    - Use an in-memory fake modelling FK `ON DELETE CASCADE` across owned tables (review_reports via sessions)
    - **Validates: Requirements 14.1, 14.2, 14.3**
    - File: `lib/db/parents.test.ts`

  - [ ]* 14.7 Write example test for Cognito-delete non-fatal + Stripe ordering
    - Mocked Stripe: cancel active/trialing/past_due then delete customer in order; mocked Cognito failure is non-fatal
    - _Requirements: 13.1, 13.2, 15.2_
    - File: `app/(app)/account/actions.test.ts`

- [x] 15. Tier 4 — infrastructure (manual / out-of-band, NOT a code task)
  - [x] 15.1 [INFRA — MANUAL] Grant `cognito-idp:AdminDeleteUser` IAM permission
    - The Vercel IAM user currently has no Cognito permissions; `AdminDeleteUserCommand` needs `cognito-idp:AdminDeleteUser` on the user pool ARN
    - This is a CDK/IAM change applied at deploy time, outside the codebase. Until applied, `adminDeleteUser` fails and is treated as non-fatal (Req 15.2). Listed here so it is not forgotten — do not implement as code.
    - _Requirements: 15.1 (deployment dependency)_

- [x] 16. Cross-cutting A — Stripe Embedded Checkout
  - [x] 16.1 Convert `startSubscriptionCheckout` to embedded mode in `app/(app)/billing/actions.ts`
    - Set `ui_mode: "embedded"` (fix invalid `"embedded_page"`); return `{ clientSecret, error? }`
    - Apply `decideTrialEligibility`; set `subscription_data.trial_period_days` only when eligible; never write subscription status during checkout creation
    - Set `return_url: ${origin}/billing?status=complete`
    - If Stripe not configured, return `{ clientSecret: null, error }`
    - _Requirements: 2.5, 18.1, 18.3, 18.5, 18.6_

  - [x] 16.2 Reconcile `components/app/subscription-checkout.tsx` and completion routing
    - Use `EmbeddedCheckoutProvider`/`EmbeddedCheckout` with returned `client_secret`; treat `{ clientSecret: null }` as error path (render message, don't mount embedded)
    - On completion, billing page reads `?status=complete`; if navigation fails, provide explicit fallback link and retried `router.replace`
    - _Requirements: 18.2, 18.4_

  - [ ]* 16.3 Write example test for embedded checkout session shape
    - Mocked Stripe: returns `client_secret` and sets `ui_mode:'embedded'`; trial_period_days applied only when eligible
    - _Requirements: 18.1, 18.5_
    - File: `app/(app)/billing/actions.test.ts`

- [ ] 17. Final checkpoint — full suite
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirement sub-clauses for traceability.
- All 27 correctness properties map to a property/example test task using the tag `// Feature: practice-billing-gdpr-completion, Property {N}: {property_text}` and run ≥ 100 iterations with fast-check.
- Pure logic (Properties 1, 4, 5, 26, 27) is tested directly; orchestration robustness (Properties 6–10, 12, 13) uses an injected fake `LanguageModel`; data-layer invariants (Properties 2, 3, 11, 14–24) use an in-memory fake of the query/transaction surface.
- Task 15.1 is the single explicitly-flagged infra/IAM item — not a coding task, listed only so it is not forgotten.
- No deployment, marketing, or user-testing tasks are included.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "4.3", "14.1"] },
    { "id": 1, "tasks": ["1.3", "2.3", "2.6", "2.7", "4.1", "5.1", "7.1", "8.1", "11.1", "16.1", "2.2", "4.4"] },
    { "id": 2, "tasks": ["4.5", "5.2", "9.4", "14.2", "16.2", "2.4", "2.8", "4.2", "5.3", "7.2", "8.2", "11.2", "16.3"] },
    { "id": 3, "tasks": ["9.1", "12.1", "2.5", "5.4", "9.5", "8.3", "11.3", "14.3", "14.6"] },
    { "id": 4, "tasks": ["12.2", "9.2", "8.4", "11.4", "14.4"] },
    { "id": 5, "tasks": ["9.3", "8.5", "11.5", "14.5", "12.3"] },
    { "id": 6, "tasks": ["8.6", "11.6", "14.7", "12.4"] },
    { "id": 7, "tasks": ["12.5"] }
  ]
}
```

> Note: task 15.1 is an out-of-band manual IAM/CDK change and is intentionally excluded from the scheduling graph (it is not executable by a coding agent). Same-file tasks (e.g. multiple property tests in one test file, or sequential edits to `webhook/route.ts`, `billing/actions.ts`, `practice/actions.ts`) are deliberately placed in different waves to avoid write conflicts.
