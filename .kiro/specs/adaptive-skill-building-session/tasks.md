# Implementation Plan: Adaptive Skill-Building Session (`adaptive`)

## Overview

This plan implements the `adaptive` ("Skill builder") session type with **maximum reuse, minimum new surface area**. The only genuinely new logic is *how the ordered list of question ids is chosen* when `type === "adaptive"`, split into a **pure, property-testable `Selection_Core`** (`lib/practice/adaptive-selection.ts`) and a thin **server-only `Selection_Service`** (`lib/db/adaptive.ts`). Everything downstream — the entitlement gate, ownership check, zombie sweep, one-active guard, `createSession`, answer firewall, idempotent grading, timer expiry, the per-session AI review in `after()`, audit logging, and the PII firewall — is type-agnostic and reused unchanged.

Work proceeds bottom-up and test-driven: config/constants → pure RNG → pure core → pure explanation helper → property + example tests → server orchestration → migration → server-action wiring → UI → parity-test extensions → verification → delivery docs. Every task names exact files and references the requirement and/or design property it implements.

Conventions followed: **TypeScript**, **vitest + fast-check** (mirroring `lib/ai/review.test.ts`), **server-only data layer** with the `@/lib/aws/rds-data` `query` wrapper, **no string interpolation of SQL values**, and **Next.js App Router** server components/actions.

## Tasks

- [x] 1. Domain config and pure tuning constants (`lib/domain.ts`)
  - [x] 1.1 Register the `adaptive` session type
    - In `lib/domain.ts`, append `"adaptive"` to `SESSION_TYPES` (`["warmup","topic","mock","adaptive"] as const`) so `SessionType` widens without breaking exhaustiveness.
    - Add the `adaptive` entry to `SESSION_TYPE_CONFIG`: `label: "Skill builder"`, `questionCount: 15`, `timeLimitSeconds: 20 * 60`, `mixedTopics: true`, and a parent-facing `description`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 1.2 Add adaptive selection tuning constants
    - In `lib/domain.ts`, export `WEIGHTING_DIRECTIONS` (`["weak_weighted","strong_weighted"] as const`), `WeightingDirection`, `DEFAULT_WEIGHTING_DIRECTION = "weak_weighted"`, `WEIGHTING_GAMMA = 1.5`, `COVERAGE_FLOOR = 1`, `ZPD_TARGET_ACCURACY = 0.75`, `DEFAULT_DIFFICULTY = 3`, `DIFFICULTY_MIN = 1`, `DIFFICULTY_MAX = 5`, `RECENCY_WINDOW_DAYS = 1`, `MASTERY_MIN = 0`, `MASTERY_MAX = 100`.
    - These are the single source of truth imported by both the core and its tests.
    - _Requirements: 2.1, 2.2, 4.1, 5.1, 5.6, 6.4_
  - [ ]* 1.3 Extend config unit tests (`lib/domain.test.ts`)
    - Assert `SESSION_TYPE_CONFIG.adaptive` fields (label/count/timeLimit/mixedTopics), `WEIGHTING_DIRECTIONS`, `DEFAULT_WEIGHTING_DIRECTION`, and `RECENCY_WINDOW_DAYS`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 6.4_

- [x] 2. Pure seeded RNG (`lib/practice/rng.ts`)
  - [x] 2.1 Implement `mulberry32`
    - Create `lib/practice/rng.ts` exporting `mulberry32(seed: number): () => number` returning floats in `[0,1)`. Pure, no imports from `server-only`/DB/`next/*`.
    - _Requirements: 5.3, 5.4, 19.1_
  - [ ]* 2.2 Unit test the RNG (`lib/practice/rng.test.ts`)
    - Same seed ⇒ identical sequence; different seeds ⇒ different sequences; all outputs in `[0,1)`.
    - _Requirements: 5.4_

- [x] 3. Pure `Selection_Core` (`lib/practice/adaptive-selection.ts`)
  - [x] 3.1 Types, cold-start detection, and topic weights
    - Create `lib/practice/adaptive-selection.ts` (pure; imports only from `@/lib/domain`). Define `Candidate`, `TopicMasteryInput`, `DifficultyAccuracyInput`, `SelectionConfig`, `SelectionInput`, `SelectionMetadata`, `SelectionResult`.
    - Implement `isColdStart(mastery)` (true iff total graded attempts across all six topics is 0) and `computeTopicWeights(mastery, direction, gamma)` — `weak_weighted`: `(MASTERY_MAX - mastery)^gamma`; `strong_weighted`: `mastery^gamma`; weight `0` for unattempted topics; epsilon-floor attempted topics so ≥1 strictly positive weight always exists.
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 3.7, 8.1, 19.1_
  - [x] 3.2 Implement `hamiltonAllocate`
    - Add `hamiltonAllocate(weights, total, coverageFloor)`: normalise to real quotas summing to `total`; handle `A > total` (top-`total` weakest-first get 1, rest 0, tie-break by fixed `TOPICS` order); else reserve `coverageFloor` per attempted topic then distribute remaining units by largest fractional remainder (ties by fixed `TOPICS` order); final force-sum reconciliation so `Σ allocation === total` exactly.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4_
  - [x] 3.3 Implement `targetDifficultyBand`
    - Add `targetDifficultyBand(accuracy, targetAccuracy, defaultDifficulty)`: among levels with `attempts >= 1`, return the difficulty whose `pct/100` is closest to `targetAccuracy`; no data ⇒ `defaultDifficulty`; never extrapolate missing levels; equal-distance ties break toward the lower difficulty.
    - _Requirements: 5.1, 5.6, 5.7_
  - [x] 3.4 Implement `selectAdaptiveQuestions` (8-step algorithm)
    - Add the exported `selectAdaptiveQuestions(input, rng)` orchestrating: (1) cold-start detect, (2) weights, (3) normalise quotas, (4) coverage-floor + Hamilton, (5) target band, (6) per-topic exclude recency → order by `|d-target|` → RNG tie-break within distance buckets → take allocation, (7) fallback chain widen → drop-recency → reallocate (record `fallbacksApplied`), (8) cold-start uniform mixed sampling. Track a global `Set` for distinctness; set `metadata.deficit`, `metadata.calibrating`, `metadata.targetDifficulty`. Pure and deterministic given `(input, rng)`.
    - _Requirements: 5.2, 5.3, 5.4, 6.2, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.2, 8.3, 8.4, 8.5, 9.1, 19.1_

- [x] 4. Pure allocation-explanation helper (`lib/practice/allocation-explanation.ts`)
  - [x] 4.1 Implement explanation helpers
    - Create `lib/practice/allocation-explanation.ts` (pure; imports `TOPIC_LABELS`, `Topic` from `@/lib/domain`). Implement `allocationFromTopics(topics)` (per-topic counts from an ordered topic list) and `formatAllocationExplanation(allocation)` (topics with non-zero count, descending by count, ties by fixed topic order; only topic display names + integer counts — calibrating-agnostic).
    - _Requirements: 9.1, 9.2, 9.5_
  - [ ]* 4.2 Unit test the explanation helper (`lib/practice/allocation-explanation.test.ts`)
    - Example tests: descending-count ordering with tie-break by topic order; output contains only labels + counts (PII-free); empty allocation ⇒ empty string.
    - _Requirements: 9.2, 9.5_

- [ ] 5. Property-based and example tests for `Selection_Core` (`lib/practice/adaptive-selection.test.ts`)
  - [ ]* 5.1 Shared fast-check generators
    - Create `lib/practice/adaptive-selection.test.ts` with generators mirroring `lib/ai/review.test.ts` style: `arbMastery` (all six topics, mastery 0..100, attempts 0..N), `arbColdStart` (all attempts 0), `arbAccuracy` (incl. empty/partial coverage), `arbPools` (controllable total distinct count straddling the `>= total` / `< total` boundary, unique ids), `arbRecency` (subset of generated ids), `arbSeed` (`fc.integer()` → `mulberry32`). Each property runs ≥100 iterations, tagged `// Feature: adaptive-skill-building-session, Property {n}: {text}`.
    - _Requirements: 19.1_
  - [ ]* 5.2 Property 1 — Allocation sums exactly to total
    - **Property 1: Allocation sums exactly to total**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 4.3, 4.4**
  - [ ]* 5.3 Property 2 — Completeness: exactly total distinct ids when candidates allow
    - **Property 2: Completeness — exactly total distinct ids when candidates allow**
    - **Validates: Requirements 7.5, 8.5**
  - [ ]* 5.4 Property 3 — Scarcity returns all available and reports the deficit
    - **Property 3: Scarcity returns all available and reports the deficit**
    - **Validates: Requirements 7.6**
  - [ ]* 5.5 Property 4 — No duplicate question ids
    - **Property 4: No duplicate question ids**
    - **Validates: Requirements 7.7**
  - [ ]* 5.6 Property 5 — Coverage floor for attempted topics
    - **Property 5: Coverage floor for attempted topics**
    - **Validates: Requirements 4.1**
  - [ ]* 5.7 Property 6 — Topic-weight monotonicity by direction
    - **Property 6: Topic-weight monotonicity by direction**
    - **Validates: Requirements 2.3, 2.4, 2.6**
  - [ ]* 5.8 Property 7 — Weak-weighted allocation weak-monotonicity
    - **Property 7: Weak-weighted allocation weak-monotonicity**
    - **Validates: Requirements 3.6**
  - [ ]* 5.9 Property 8 — Allocation only to attempted topics outside cold start
    - **Property 8: Allocation only to attempted topics outside cold start**
    - **Validates: Requirements 3.7**
  - [ ]* 5.10 Property 9 — Determinism / purity under a fixed seed
    - **Property 9: Determinism / purity under a fixed seed**
    - **Validates: Requirements 2.5, 5.4, 19.1**
  - [ ]* 5.11 Property 10 — Recency exclusion before difficulty targeting
    - **Property 10: Recency exclusion before difficulty targeting**
    - **Validates: Requirements 6.2**
  - [ ]* 5.12 Property 11 — Target difficulty is the attempted level closest to the target window
    - **Property 11: Target difficulty is the attempted level closest to the target window**
    - **Validates: Requirements 5.1, 5.6, 5.7**
  - [ ]* 5.13 Property 12 — Cold start detection drives the calibrating flag
    - **Property 12: Cold start detection drives the calibrating flag**
    - **Validates: Requirements 8.1, 8.4**
  - [ ]* 5.14 Property 13 — Allocation reflects the actual selection
    - **Property 13: Allocation reflects the actual selection**
    - **Validates: Requirements 9.1**
  - [ ]* 5.15 Property 14 — Allocation explanation is ordered and PII-free
    - **Property 14: Allocation explanation is ordered and PII-free** (imports `formatAllocationExplanation` from `lib/practice/allocation-explanation.ts`)
    - **Validates: Requirements 9.2, 9.5**
  - [ ]* 5.16 Example-based unit tests
    - In the same file: ZPD targeting (mixed-difficulty pool, allocation 1 picks nearest target, Req 5.2); RNG tie-break (same seed agrees, different seeds may differ, Req 5.3); Hamilton tie-break by fixed topic order (Req 3.5); `A > total` branch (exactly `total` topics get 1, weakest-first, Req 4.2); fallback-chain ordering (`metadata.fallbacksApplied` records widen → drop-recency → reallocate and total met, Req 7.1–7.4); cold-start uniform sampling not weighted (Req 8.2).
    - _Requirements: 3.5, 4.2, 5.2, 5.3, 7.1, 7.2, 7.3, 7.4, 8.2_

- [ ] 6. Checkpoint — pure core complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. `Selection_Service` server orchestration (`lib/db/adaptive.ts`)
  - [x] 7.1 Implement candidate pools, recency set, and the selector
    - Create `lib/db/adaptive.ts` with `import "server-only"`. Implement `getCandidatePools()` (`SELECT id, topic, difficulty FROM questions WHERE active ORDER BY topic, difficulty` → `Record<Topic, Candidate[]>`), `getRecentlyAnsweredSet(childId, windowDays)` (the exact recency anti-join joining `session_answers sa JOIN sessions s ON s.id = sa.session_id` filtering `s.child_id = :childId` and `sa.answered_at >= now() - (:windowDays::int * interval '1 day')`, bound params only), and `selectAdaptiveQuestionsForChild(childId)` which gathers `getChildProgress` (zero-filled to all six topics) + `getAccuracyByDifficulty`, derives a per-request seed, calls `mulberry32` + `selectAdaptiveQuestions`, and maps selected ids back to topics (id-order `questionTopics`) returning `{ questionIds, questionTopics, allocation, metadata }`.
    - _Requirements: 6.1, 6.3, 7.1, 19.1_
  - [ ]* 7.2 Integration/smoke tests for the two queries (`lib/db/adaptive.test.ts`)
    - Against an in-memory fake of `@/lib/aws/rds-data` (mirroring `lib/db/revenue.test.ts`): assert the recency query joins `session_answers → sessions ON session_id`, filters `child_id` + `answered_at` within the window, and returns distinct ids; assert candidate-pool query returns active questions grouped per topic as `{id, difficulty}`.
    - _Requirements: 6.1, 6.3_

- [x] 8. Schema migration — enum value + recency index
  - [x] 8.1 Add `scripts/sql/002_adaptive.sql`
    - Create the migration with exactly two statements: `ALTER TYPE session_type ADD VALUE IF NOT EXISTS 'adaptive';` and `CREATE INDEX IF NOT EXISTS idx_answers_child_recent ON session_answers (session_id, answered_at);`. Include a header comment documenting the index rationale (leading `session_id` = join key, trailing `answered_at` = range filter; `child_id` reached via `sessions`; denormalisation considered and deferred for v1).
    - **NOTE:** `ALTER TYPE ... ADD VALUE` must NOT run inside a transaction. `scripts/migrate.mjs` executes each statement individually (`splitSql` + per-statement `ExecuteStatementCommand`), so this file is compatible — do not wrap statements in `BEGIN/COMMIT`.
    - _Requirements: 1.7, 10.1, 10.2, 10.3, 10.5, 10.6_
  - [ ]* 8.2 Migration smoke test (`scripts/sql/002_adaptive.test.ts`)
    - Read `002_adaptive.sql` and assert it contains the `ALTER TYPE session_type ADD VALUE IF NOT EXISTS 'adaptive'` and `CREATE INDEX IF NOT EXISTS idx_answers_child_recent ON session_answers (session_id, answered_at)` statements and introduces no other schema change (no extra `ALTER`/`CREATE`/`DROP`); assert no transaction wrapper is present.
    - _Requirements: 1.7, 10.1, 10.3, 10.6_

- [x] 9. Practice_Service wiring (`app/(app)/practice/actions.ts`)
  - [x] 9.1 Extend `startSchema` for adaptive
    - Add `"adaptive"` to the `type` enum and a `.refine` rejecting a supplied `topic` when `type === "adaptive"` (message per Req 1.6, `path: ["topic"]`).
    - _Requirements: 1.5, 1.6, 11.4_
  - [x] 9.2 Add the adaptive selection branch
    - In `startSessionAction`, after the unchanged entitlement gate, ownership check, zombie sweep, and one-active guard, branch on `type === "adaptive"` to call `selectAdaptiveQuestionsForChild(child.id)` (instead of `pickQuestionIds`), set `orderedIds`/`questionTopics` from its result, return the existing "No questions are available yet" error when empty, then fall through to the identical `createSession`/audit/unique-index-catch/redirect path.
    - _Requirements: 1.5, 11.1, 11.2, 11.3, 12.1, 12.2, 12.3, 12.4, 17.1_
  - [ ]* 9.3 Schema accept/reject example tests (`app/(app)/practice/actions.test.ts`)
    - `startSchema.safeParse` accepts adaptive-without-topic and rejects adaptive-with-topic.
    - _Requirements: 1.5, 1.6_

- [x] 10. UI — surface allocation, calibrating note, and the start option
  - [x] 10.1 Player page allocation + calibrating note (`app/(app)/practice/[sessionId]/page.tsx`)
    - Gated on `session.type === "adaptive"`: compute the allocation breakdown from already-loaded `questions` via `allocationFromTopics` → `formatAllocationExplanation` (no extra query); additionally read `getChildProgress(session.childId)` **during the active session** (pre-session state) and render the "calibrating across mixed topics" note when every topic shows `insufficient_data` (cold start). Omit either block on error (non-blocking).
    - _Requirements: 9.3, 9.4, 9.6_
  - [x] 10.2 Result page allocation only (`app/(app)/practice/[sessionId]/result/page.tsx`)
    - Gated on `session.type === "adaptive"`, near the existing "How each topic went" block: render the allocation breakdown from `questions` (`allocationFromTopics` → `formatAllocationExplanation`); do NOT render the calibrating note (cold start is no longer derivable post-finish). Omit on error (non-blocking).
    - _Requirements: 9.3, 9.6_
  - [x] 10.3 Add the "Skill builder" start option (`app/(app)/practice/new/page.tsx`)
    - Surface the `adaptive` session type in the start UI using `SESSION_TYPE_CONFIG.adaptive.label`/`description`, submitting `type=adaptive` with no `topic`.
    - _Requirements: 1.4, 1.5_

- [ ] 11. Parity test extensions (extend existing, do not duplicate)
  - [ ]* 11.1 Extend timer / one-active generators (`lib/db/sessions.test.ts`)
    - Where the existing Property 3 / `isSessionActive` tests enumerate session types, include `adaptive` so the one-active-session and timer-expiry invariants are exercised for the new type without duplicating the property.
    - _Requirements: 12.1, 12.4, 15.1, 15.2, 15.3_
  - [ ]* 11.2 Extend PII firewall review inputs (`lib/ai/review.test.ts`)
    - Add adaptive-originated `ReviewItemContext` inputs to the existing Property 8 / PII generators so the review-context/prompt contains only maths content + year group for adaptive sessions; confirm the answer-firewall (`toClientQuestion`) and idempotent-grading behaviours remain type-agnostic and need no adaptive-specific duplicate (they do not branch on session type).
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 14.1, 14.2, 14.3, 18.1, 18.2, 18.3, 18.4, 18.5_

- [x] 12. Checkpoint — feature wired end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Verification
  - [x] 13.1 Run the full test suite
    - Run the project's vitest suite once (single-run, not watch) and fix any failures introduced by this feature.
    - _Requirements: 19.1_
  - [x] 13.2 Run the build
    - Run the Next.js/TypeScript build and resolve any type or compile errors (the widened `SessionType` union should type-check across all `Record<SessionType, …>` and `switch` sites).
    - _Requirements: 1.1_

- [x] 14. Delivery documentation (final, after implementation + verification)
  - [x] 14.1 Update `submission/database.md`
    - Feature the adaptive session as evidence of database strength: the recency anti-join, the `(session_id, answered_at)` composite index choice and rationale (why `child_id` is reached through `sessions`, and the considered-but-deferred denormalisation), the relational mastery (`getChildProgress`) and accuracy-by-difficulty reads, and the chart/query story.
    - _Requirements: 10.4_
  - [x] 14.2 Update `submission/vercel.md` where relevant
    - Note the new session type, the pure property-tested selection core with an injected RNG, and the player-page explainability, as evidence of best engineering practice and product/parent fit.
    - _Requirements: 9.3, 9.4, 19.1_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each property test (5.2–5.15) is its own sub-task, tagged with its design property number and the requirement clauses it validates, and runs ≥100 fast-check iterations mirroring `lib/ai/review.test.ts`.
- Because all property/example tests live in the single file `lib/practice/adaptive-selection.test.ts`, their sub-tasks are sequenced across separate waves (same-file writes cannot run in parallel); the dependency graph reflects this.
- The migration (8.1) and its recency index are deliberately their own task; `ALTER TYPE ... ADD VALUE` must not be wrapped in a transaction, which `scripts/migrate.mjs` already honours by executing statements individually.
- Parity tasks (11.x) extend existing tests/generators rather than adding duplicate properties; the firewall and idempotent-grading paths are type-agnostic and require no new type-specific tests.
- The calibrating note is derived (not persisted) on the player page from the pre-session `getChildProgress` read, preserving the "no schema change beyond the recency index" guarantee (Req 10.6).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "8.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "8.2"] },
    { "id": 2, "tasks": ["1.3", "3.1", "4.1", "9.1", "10.3", "11.1", "11.2"] },
    { "id": 3, "tasks": ["3.2", "4.2"] },
    { "id": 4, "tasks": ["3.3"] },
    { "id": 5, "tasks": ["3.4"] },
    { "id": 6, "tasks": ["5.1", "7.1"] },
    { "id": 7, "tasks": ["5.2", "7.2", "9.2"] },
    { "id": 8, "tasks": ["5.3", "9.3", "10.1", "10.2"] },
    { "id": 9, "tasks": ["5.4"] },
    { "id": 10, "tasks": ["5.5"] },
    { "id": 11, "tasks": ["5.6"] },
    { "id": 12, "tasks": ["5.7"] },
    { "id": 13, "tasks": ["5.8"] },
    { "id": 14, "tasks": ["5.9"] },
    { "id": 15, "tasks": ["5.10"] },
    { "id": 16, "tasks": ["5.11"] },
    { "id": 17, "tasks": ["5.12"] },
    { "id": 18, "tasks": ["5.13"] },
    { "id": 19, "tasks": ["5.14"] },
    { "id": 20, "tasks": ["5.15"] },
    { "id": 21, "tasks": ["5.16"] },
    { "id": 22, "tasks": ["13.1", "13.2"] },
    { "id": 23, "tasks": ["14.1", "14.2"] }
  ]
}
```
