# Requirements Document

## Introduction

This feature adds a new practice session type, **`adaptive`** (parent-facing display name **"Skill builder"**), to the ApexMaths UK 11+ maths app (Next.js 16 on Vercel, Amazon Aurora PostgreSQL via the RDS Data API, single model Claude Sonnet 4.6 on Amazon Bedrock).

Unlike the existing fixed session types — `warmup` (10 questions, mixed topics, 10 min), `topic` (5 questions, single topic, 10 min) and `mock` (30 questions, mixed topics, 50 min) — an `adaptive` session samples a *weighted* set of questions **across all 6 topics** based on the Child's per-topic mastery, so practice concentrates where it helps most. The default weighting is **weak-weighted** (inverse mastery): weaker topics receive proportionally more questions, building all skills with emphasis on remediation.

The session is selected in four conceptual stages, all of which must be deterministic and testable in a pure core:

- **Tier 1 — Weighted topic allocation:** derive a per-topic weight from the inverse of `progress.mastery_score`, normalise it, and allocate an integer per-topic question count that sums **exactly** to the session total using a largest-remainder (Hamilton) method, subject to a **coverage floor** of at least one question per attempted topic.
- **Tier 2 — Difficulty targeting (ZPD):** within each topic, prefer questions near the Child's target difficulty band (the band where the Child scores ~70–80%, derived from `getAccuracyByDifficulty`), with a random tie-break.
- **Recency exclusion + fallback chain:** exclude questions the Child answered in the last 1 day; if filtering leaves a topic short, relax constraints (drop recency, then widen difficulty) and reallocate any shortfall to other topics so the session **always** returns exactly the target number of questions.
- **Cold start:** when the Child has insufficient history, fall back to uniform mixed sampling and mark the session "calibrating".

The new session type MUST reach **full parity** with the existing session lifecycle: the `requireEntitledParent` gate, one-active-session-per-child enforcement (the `uniq_active_session_per_child` partial unique index and the zombie-clearing sweep), the answer firewall (`toClientQuestion` strips `correctIndex`), server-authoritative idempotent grading, server-enforced timer expiry, the per-session AI review run in Next.js `after()`, audit logging, and the GDPR/PII firewall (no PII in any AI context).

One schema change is in scope: an index on `session_answers` optimised for the recency anti-join (the Child's questions answered in the last day). No other schema change is expected for v1.

### Architectural Context (constraints that shape requirements)

- Vercel serverless functions freeze CPU once the HTTP response is sent, so any AI work for the per-session review MUST complete within the request that completes the session (using Next.js `after()`), exactly as the existing review path does.
- The "answer firewall" (`correctIndex` never serialised to the client mid-session) and the PII firewall (only question text/options/`imageDescription` and a Child's year group may reach the model) MUST be preserved unchanged.
- All `id` and foreign-key columns are `TEXT` (see `scripts/sql/001_schema.sql`); no requirement may reintroduce the `uuid` column type.
- The recency anti-join must account for the actual schema: `session_answers` holds `session_id`, `question_id`, `answered_at` and `topic`, while `child_id` lives on `sessions` and is joined via `session_id`.
- The selection core must be a pure, deterministic function (given its inputs, including an injected randomness source) so it is suitable for property-based testing with `fast-check`, which the repo already uses.

### Out of Scope

- THE Feature SHALL NOT introduce a new AI model, background queue, cron job, or scheduled task; the per-session review remains synchronous within the completing request via Next.js `after()`.
- THE Feature SHALL NOT alter the existing `warmup`, `topic`, or `mock` session behaviour, configuration, or question counts.
- THE Feature SHALL NOT change the answer firewall or the PII firewall.
- THE Feature SHALL NOT add any schema change other than the `session_answers` recency index.
- THE Feature SHALL NOT switch away from Aurora, Cognito, or Bedrock.

> Documentation note (for the tasks phase, not a requirement): after implementation, `submission/database.md` (and `submission/vercel.md` where relevant) must be updated to present this feature as evidence of database strength, engineering best practice, and product/parent fit.

## Glossary

- **System**: The ApexMaths application as a whole (Next.js server actions, API routes, and data layer).
- **Practice_Service**: The server actions managing practice sessions (`app/(app)/practice/actions.ts`).
- **Adaptive_Session**: A `Practice_Session` whose `type` is `adaptive`.
- **Selection_Core**: The pure, deterministic function (no I/O) that, given per-topic mastery, per-difficulty accuracy, candidate question pools, an excluded-question set, configuration, and an injected randomness source, returns the ordered list of selected question ids together with the per-topic allocation and selection metadata.
- **Selection_Service**: The server-side orchestration that gathers inputs from Aurora (progress, accuracy-by-difficulty, candidate questions, recently-answered question ids), invokes the Selection_Core, and returns the selected question ids for `createSession`.
- **Topic**: One of the six curriculum topics defined by the `topic` enum: `number`, `fractions_decimals_percentages`, `ratio_proportion`, `algebra`, `geometry`, `data_handling`.
- **Mastery_Score**: The `progress.mastery_score` value for a Child-Topic pair, a percentage in the range 0–100.
- **Weighting_Direction**: A configurable parameter selecting whether topic weights are derived from inverse mastery (`weak_weighted`) or direct mastery (`strong_weighted`); the default is `weak_weighted`.
- **Topic_Weight**: A non-negative real number derived from a Topic's Mastery_Score per the Weighting_Direction, before normalisation.
- **Topic_Allocation**: The integer number of questions assigned to a Topic for one Adaptive_Session; the set of Topic_Allocations sums exactly to the session total.
- **Hamilton_Method**: The largest-remainder apportionment method used to convert normalised real-valued quotas into integer Topic_Allocations summing exactly to the total.
- **Coverage_Floor**: The minimum number of questions (1) that every Attempted_Topic receives in an Adaptive_Session, provided the session total and candidate availability permit.
- **Attempted_Topic**: A Topic for which the Child has at least one graded answer recorded (`progress.attempts >= 1`).
- **Target_Difficulty_Band**: The integer difficulty level (1–5) at which the Child's accuracy is closest to the 70–80% target proficiency window, derived from `getAccuracyByDifficulty`; used as the centre of the Zone of Proximal Development.
- **ZPD**: Zone of Proximal Development — the difficulty range around the Target_Difficulty_Band preferred for question selection.
- **Recency_Window**: The look-back period (1 day) within which previously answered questions are excluded from selection.
- **Recently_Answered_Set**: The set of `question_id`s the Child answered (`answered_at` within the Recency_Window) across all of the Child's sessions.
- **Fallback_Chain**: The ordered constraint-relaxation sequence used when a Topic cannot fill its allocation: (1) widen the difficulty band, (2) drop the recency exclusion, (3) reallocate the shortfall to other topics.
- **Cold_Start**: The state in which the Child has insufficient history to weight topics (every Topic classified `insufficient_data`, i.e. total graded attempts across all topics is 0).
- **Calibrating**: A flag on an Adaptive_Session indicating it was selected by uniform mixed sampling because of Cold_Start.
- **Allocation_Explanation**: A surfaceable, human-readable description of the per-topic allocation (e.g. "5 Geometry, 4 Fractions, 3 Ratio, 2 Number, 1 Algebra").
- **Answer_Firewall**: The rule that a question's `correctIndex` (and answer-only `imageDescription`) is never serialised to the client during an active session (`toClientQuestion`).
- **PII_Firewall**: The rule restricting model inputs to question text, options, `imageDescription`, and the Child's year group, excluding all identifiers and personal data.
- **Parent**: A subscriber account; `parents` row keyed by the Cognito `sub`.
- **Child**: A learner profile owned by a Parent.
- **Active_Session**: A `Practice_Session` whose status is `active` and whose `expires_at` is in the future.

---

## Requirements

### Requirement 1: Register the adaptive session type

**User Story:** As a parent, I want a "Skill builder" practice option, so that my child can practise a personalised mix of questions concentrated where they need the most help.

#### Acceptance Criteria

1. THE System SHALL add `adaptive` to the set of valid session types alongside `warmup`, `topic`, and `mock`.
2. THE System SHALL configure the Adaptive_Session with a question count of 15 and a time limit of 1200 seconds (20 minutes).
3. THE System SHALL configure the Adaptive_Session as a mixed-topics session that does not require a single chosen Topic.
4. THE System SHALL expose the Adaptive_Session display label as "Skill builder".
5. WHEN a Parent starts a session of type `adaptive` without a `topic` parameter, THE Practice_Service SHALL accept the request.
6. IF a Parent starts a session of type `adaptive` and supplies a `topic` parameter, THEN THE Practice_Service SHALL reject the request, because an Adaptive_Session is a mixed-topics session for which a single `topic` parameter is invalid.
7. THE System SHALL treat the addition of the `adaptive` session type as a change to the `session_type` enum applied as a schema migration to the existing Aurora schema.

### Requirement 2: Configurable weighting direction defaulting to weak-weighted

**User Story:** As a product owner, I want the adaptive session to emphasise weaker topics by default, so that practice builds the skills the child most needs while the direction stays configurable for future experiments.

#### Acceptance Criteria

1. THE System SHALL expose Weighting_Direction as a configuration parameter with the values `weak_weighted` and `strong_weighted`.
2. THE System SHALL default Weighting_Direction to `weak_weighted`.
3. WHILE Weighting_Direction is `weak_weighted`, THE Selection_Core SHALL derive each Topic_Weight as a strictly decreasing function of that Topic's Mastery_Score, so that a Topic with a lower Mastery_Score receives a Topic_Weight greater than or equal to a Topic with a higher Mastery_Score.
4. WHILE Weighting_Direction is `strong_weighted`, THE Selection_Core SHALL derive each Topic_Weight as a non-decreasing function of that Topic's Mastery_Score.
5. THE Selection_Core SHALL compute Topic_Weights deterministically from the supplied per-topic Mastery_Scores and Weighting_Direction, producing identical weights for identical inputs.
6. THE Selection_Core SHALL ensure that at least one Topic_Weight across the Attempted_Topics is strictly positive, so that topic selection always remains possible and the weight set is never entirely zero.

### Requirement 3: Weighted integer topic allocation summing exactly to the total

**User Story:** As a learner, I want my session split across topics in proportion to where I need practice, so that the time is spent where it helps most without ever shortening the session.

#### Acceptance Criteria

1. THE Selection_Core SHALL normalise the set of Topic_Weights across all Attempted_Topics into real-valued quotas whose sum equals the session total.
2. THE Selection_Core SHALL convert the real-valued quotas into integer Topic_Allocations using the Hamilton_Method (allocate the floor of each quota, then distribute remaining units one at a time to the topics with the largest fractional remainders).
3. THE Selection_Core SHALL produce a set of Topic_Allocations whose sum equals the session total exactly.
4. IF the Hamilton_Method would produce Topic_Allocations summing to zero despite a strictly positive session total, THEN THE Selection_Core SHALL force the Topic_Allocations to sum to the session total even where doing so breaks the weighting constraints, because the exact session total is a hard invariant.
5. WHEN two topics have equal fractional remainders during Hamilton_Method distribution, THE Selection_Core SHALL break the tie deterministically by a fixed topic ordering.
6. WHILE Weighting_Direction is `weak_weighted`, THE Selection_Core SHALL produce Topic_Allocations in which a strictly weaker Topic (strictly lower Mastery_Score) receives a Topic_Allocation greater than or equal to that of a strictly stronger Topic, except where the Coverage_Floor or per-topic candidate availability forces otherwise.
7. THE Selection_Core SHALL allocate questions only to Attempted_Topics when not in Cold_Start.

### Requirement 4: Coverage floor for every attempted topic

**User Story:** As a parent, I want my child to keep all topics warm, so that the adaptive session builds every skill rather than drilling one weak area exclusively.

#### Acceptance Criteria

1. WHILE not in Cold_Start, THE Selection_Core SHALL assign every Attempted_Topic a Topic_Allocation of at least the Coverage_Floor of 1, provided the number of Attempted_Topics does not exceed the session total.
2. IF the number of Attempted_Topics exceeds the session total, THEN THE Selection_Core SHALL allocate one question to each of the highest-priority topics up to the session total, prioritising topics by Topic_Weight (weakest first under `weak_weighted`), and SHALL allocate zero to the remainder.
3. WHEN enforcing the Coverage_Floor reduces the units available for weighted distribution, THE Selection_Core SHALL distribute only the remaining units by the Hamilton_Method after reserving one unit per Attempted_Topic.
4. THE Selection_Core SHALL keep the sum of Topic_Allocations equal to the session total after the Coverage_Floor is applied.

### Requirement 5: Difficulty targeting within each topic (ZPD)

**User Story:** As a learner, I want questions pitched at the right level of challenge, so that I am stretched without being overwhelmed.

#### Acceptance Criteria

1. THE Selection_Core SHALL derive a Child's Target_Difficulty_Band as the difficulty level (1–5) whose measured accuracy is closest to the 70–80% target proficiency window, from the supplied per-difficulty accuracy data.
2. WHEN selecting the questions for a Topic, THE Selection_Core SHALL prefer candidate questions whose difficulty is nearest to the Target_Difficulty_Band.
3. WHEN multiple candidate questions are equally near the Target_Difficulty_Band, THE Selection_Core SHALL break the tie using the injected randomness source.
4. THE Selection_Core SHALL produce identical selections for identical inputs when supplied the same seeded randomness source, so the selection is deterministic and reproducible under test.
5. IF the randomness seeding mechanism fails, THEN THE Selection_Core MAY behave non-deterministically as graceful degradation rather than aborting, because determinism is guaranteed only when a valid seeded randomness source is supplied.
6. WHERE per-difficulty accuracy data is unavailable for a Child, THE Selection_Core SHALL default the Target_Difficulty_Band to a configured middle difficulty level.
7. WHERE per-difficulty accuracy data is incomplete because only some difficulty levels have been attempted, THE Selection_Core SHALL use the configured default difficulty for any missing levels and SHALL NOT extrapolate accuracy for the missing levels.

### Requirement 6: Recency exclusion window

**User Story:** As a learner, I want to avoid repeating questions I just saw, so that each session feels fresh and tests genuine recall.

#### Acceptance Criteria

1. THE Selection_Service SHALL compute the Recently_Answered_Set as the distinct `question_id`s the Child answered with `answered_at` within the Recency_Window of 1 day, across all of the Child's sessions.
2. WHEN selecting questions, THE Selection_Core SHALL exclude every question in the Recently_Answered_Set before applying difficulty targeting.
3. THE Selection_Service SHALL determine the Recently_Answered_Set by joining `session_answers` to `sessions` on `session_id` and filtering on the Child's `child_id` and on `answered_at` within the Recency_Window.
4. THE System SHALL expose the Recency_Window as a single configurable constant defaulting to 1 day.

### Requirement 7: Fallback chain guaranteeing the session total is always met

**User Story:** As a parent, I want the session to always contain the full set of questions, so that a child is never short-changed because of filtering.

#### Acceptance Criteria

1. IF a Topic's filtered candidate pool (after recency exclusion and difficulty targeting) is smaller than its Topic_Allocation, THEN THE Selection_Core SHALL first widen the difficulty band around the Target_Difficulty_Band to admit more candidates for that Topic.
2. IF widening the difficulty band does not yield enough candidates for a Topic, THEN THE Selection_Core SHALL drop the recency exclusion for that Topic and admit recently-answered questions to fill the remaining allocation.
3. IF a Topic still cannot fill its Topic_Allocation after widening difficulty and dropping recency, THEN THE Selection_Core SHALL reallocate the unmet shortfall to other topics that have spare candidate capacity, preserving the session total.
4. THE Selection_Core SHALL apply the Fallback_Chain in the order: widen difficulty, then drop recency, then reallocate across topics.
5. WHEN the total number of distinct active candidate questions across all topics is greater than or equal to the session total, THE Selection_Core SHALL return exactly the session total number of distinct question ids, reallocating across topics to meet the session total regardless of any individual topic's allocation shortfall.
6. IF the total number of distinct active candidate questions across all topics is fewer than the session total, THEN THE Selection_Core SHALL return exactly the available distinct candidates, SHALL NOT exceed the session total, and SHALL report the deficit in the selection metadata.
7. THE Selection_Core SHALL NOT return any duplicate question id within a single Adaptive_Session.

### Requirement 8: Cold-start uniform sampling

**User Story:** As a new user, I want a sensible first session even before the app knows my strengths, so that my child can start practising immediately while the system calibrates.

#### Acceptance Criteria

1. WHEN every Topic for the specific Child is classified `insufficient_data` (that Child has 0 graded attempts across all topics), THE Selection_Core SHALL treat the request as Cold_Start, regardless of any sibling children on the same Parent account.
2. WHILE in Cold_Start, THE Selection_Core SHALL select questions by uniform mixed sampling across all topics, in the same manner as a `warmup` or `mock` session, rather than by mastery weighting.
3. WHILE in Cold_Start, THE Selection_Core SHALL still exclude the Recently_Answered_Set where doing so leaves enough candidates to meet the session total, and SHALL apply the Fallback_Chain otherwise.
4. WHEN an Adaptive_Session is selected under Cold_Start, THE System SHALL mark the session as Calibrating in the selection metadata.
5. WHEN an Adaptive_Session is Calibrating, THE System SHALL still return exactly the session total number of distinct questions, subject to overall candidate availability per Requirement 7.

### Requirement 9: Explainable allocation surfaced to the parent

**User Story:** As a parent, I want to see how the session was split across topics, so that I understand and trust why these questions were chosen.

#### Acceptance Criteria

1. THE Selection_Core SHALL return the per-topic allocation (the count selected per Topic) as part of its result.
2. THE System SHALL produce an Allocation_Explanation that lists each Topic with a non-zero allocation and its question count, ordered by descending count.
3. THE System SHALL make the Allocation_Explanation available for display to the Parent for an Adaptive_Session only, and SHALL NOT produce an Allocation_Explanation for `warmup`, `topic`, or `mock` sessions.
4. WHEN an Adaptive_Session is Calibrating, THE System SHALL indicate in the parent-facing explanation that the session is calibrating across mixed topics.
5. THE Allocation_Explanation SHALL contain only Topic names and counts and SHALL NOT contain any identifier or personal data.
6. IF the System cannot generate or display the Allocation_Explanation, THEN the Adaptive_Session SHALL still proceed, because the Allocation_Explanation is non-blocking.

### Requirement 10: Optimal recency index on session_answers

**User Story:** As an operator, I want the recency anti-join to stay fast as data grows, so that starting an adaptive session is efficient at scale.

#### Acceptance Criteria

1. THE System SHALL add a database index supporting the recency lookup of a Child's questions answered within the Recency_Window.
2. THE System SHALL choose an index whose leading column matches the recency query's join and filter shape, given that the recency query joins `session_answers` to `sessions` on `session_id` and filters `session_answers.answered_at`.
3. THE System SHALL provide a composite index on `session_answers(session_id, answered_at)` so the join key is the leading column and `answered_at` enables range filtering within each session, with `question_id` available for the anti-join result.
4. THE System SHALL document the index choice with a justification that is correct for this schema, including why `child_id` is reached through `sessions` rather than stored on `session_answers`, and SHALL state whether denormalising `child_id` onto `session_answers` was considered and why it was or was not adopted for v1.
5. THE System SHALL treat the addition of the recency index as a schema migration applied to the existing Aurora schema.
6. THE System SHALL NOT add any schema change beyond the recency index for this feature.

### Requirement 11: Parity — entitlement gate and ownership

**User Story:** As the business, I want adaptive sessions gated and scoped exactly like every other session, so that only entitled parents can start them for their own children.

#### Acceptance Criteria

1. WHEN a request to start an Adaptive_Session is received, THE Practice_Service SHALL require an entitled Parent via the `requireEntitledParent` gate before any other work.
2. WHEN a request to start an Adaptive_Session is received, THE Practice_Service SHALL verify that the target Child is owned by the requesting Parent before creating the session.
3. IF the requesting Parent is not entitled or does not own the target Child, THEN THE Practice_Service SHALL return an explicit rejection response and SHALL NOT create a session, and SHALL NOT fail silently.
4. THE Practice_Service SHALL validate the start request input for an Adaptive_Session before sampling questions.

### Requirement 12: Parity — one active session per child

**User Story:** As a parent, I want only one practice session active per child at a time, so that adaptive sessions cannot run alongside another session and corrupt progress.

#### Acceptance Criteria

1. WHEN the Practice_Service receives a request to start an Adaptive_Session for a Child that already has an Active_Session, THE Practice_Service SHALL reject the new session and SHALL return the existing Active_Session identifier with options to resume or end it.
2. BEFORE creating an Adaptive_Session, THE Practice_Service SHALL sweep elapsed-but-unflipped active sessions for the Child so a zombie session does not block the new session via the `uniq_active_session_per_child` partial unique index.
3. IF a concurrent double-submit causes the `uniq_active_session_per_child` index to reject the second active insert, THEN THE Practice_Service SHALL surface the existing Active_Session rather than an error.
4. WHILE determining whether an Active_Session exists, THE Practice_Service SHALL treat a session whose `expires_at` has passed as not active.

### Requirement 13: Parity — answer firewall

**User Story:** As a data controller, I want adaptive sessions to never leak answers to the browser, so that the answer firewall holds for all session types.

#### Acceptance Criteria

1. WHILE an Adaptive_Session is active, THE System SHALL serialise questions to student-facing clients only via the answer-stripping projection, excluding `correctIndex`.
2. WHERE the consumer is a privileged administrative or teacher interface that legitimately requires answer data, THE System MAY serialise `correctIndex` to that privileged interface, without weakening the exclusion of `correctIndex` from student-facing clients.
3. WHILE an Adaptive_Session is active, THE System SHALL NOT serialise a question's answer-only `imageDescription` to the client.
4. THE System SHALL hold each question's `correctIndex` server-side and SHALL reveal it only after the Child has committed an answer for that question.

### Requirement 14: Parity — server-authoritative idempotent grading

**User Story:** As the business, I want adaptive answers graded on the server and recorded once, so that grading is trustworthy and resubmissions cannot change a recorded answer.

#### Acceptance Criteria

1. WHEN a Child submits an answer in an Adaptive_Session, THE System SHALL compute correctness on the server from the server-held `correctIndex`, using only the slot position and chosen option index sent by the client.
2. WHEN an answer is recorded for a slot that already has a recorded answer, THE System SHALL leave the original recorded answer unchanged (first answer wins).
3. THE System SHALL map a submitted slot position to a question id only through the server-held session mapping, never from client-supplied question identifiers.

### Requirement 15: Parity — server-enforced timer expiry

**User Story:** As the business, I want the adaptive session timer enforced on the server, so that answers after the deadline are rejected consistently.

#### Acceptance Criteria

1. THE System SHALL set an Adaptive_Session's `expires_at` from the configured time limit at creation.
2. IF an answer is submitted for an Adaptive_Session whose `expires_at` has passed or whose status is not active, THEN THE System SHALL reject the answer as expired and SHALL transition the session to `expired` if still active.
3. WHEN an Adaptive_Session is accessed after its deadline, THE System SHALL treat the elapsed session as expired rather than active.

### Requirement 16: Parity — per-session AI review on finish

**User Story:** As a parent, I want a results review after an adaptive session, so that I understand each mistake just as I do for other session types.

#### Acceptance Criteria

1. WHEN an Adaptive_Session is finished, THE System SHALL compute and persist the score and per-topic summary before any AI work begins.
2. WHEN an Adaptive_Session is finished, THE System SHALL roll the answers into per-topic progress via the existing progress aggregation.
3. WHEN an Adaptive_Session is finished with at least one incorrect or unattempted answer, THE System SHALL generate the per-session AI review using Next.js `after()` so the Parent is redirected immediately.
4. IF AI generation fails or exceeds its time budget, THEN THE System SHALL finalise the review with deterministic fallback text and SHALL NOT block session completion.
5. THE System SHALL store exactly one review report per Adaptive_Session in the existing `review_reports` table.

### Requirement 17: Parity — audit logging

**User Story:** As a data controller, I want adaptive session lifecycle events audited, so that activity is traceable like every other session.

#### Acceptance Criteria

1. WHEN an Adaptive_Session is started, THE System SHALL write an append-only audit record capturing the session id, child id, and session type.
2. WHEN an Adaptive_Session is completed, THE System SHALL write an append-only audit record capturing the session id, score, total, and completion reason.
3. THE System SHALL NOT include a Child's display name or other personal data beyond identifiers in audit records.

### Requirement 18: Parity — GDPR / PII firewall in AI context

**User Story:** As a data controller, I want the adaptive review to send only non-identifying content to the model, so that personal data never leaves the trust boundary.

#### Acceptance Criteria

1. WHEN the System builds a model prompt for an Adaptive_Session review, THE System SHALL include all of the following content: question text, question options, question `imageDescription`, and the Child's year group.
2. IF any of the required prompt content (question text, question options, question `imageDescription`, or the Child's year group) is absent, THEN THE System SHALL NOT build an empty or contentless model prompt.
3. THE System SHALL NOT include a Child's display name, a Parent's email, or any identifier (parent id, child id, session id) in any model prompt for an Adaptive_Session.
4. THE System SHALL NOT send a question's `imageUrl` to the model.
5. THE System SHALL NOT serialise `imageDescription` to the client for an Adaptive_Session, and MAY cache or log `imageDescription` server-side provided it never reaches the client.

### Requirement 19: Pure, testable selection core

**User Story:** As an engineer, I want the weighting and allocation logic to be a pure deterministic function, so that I can verify its invariants with property-based tests.

#### Acceptance Criteria

1. THE Selection_Core SHALL be a pure function that performs no I/O and depends only on its supplied inputs and an injected randomness source.
2. THE Selection_Core SHALL produce identical outputs for identical inputs, including the same seeded randomness source.
3. FOR ALL valid inputs, THE Selection_Core SHALL produce Topic_Allocations whose sum equals the session total whenever total available candidates are greater than or equal to the session total.
4. FOR ALL valid inputs while not in Cold_Start, THE Selection_Core SHALL assign every Attempted_Topic a Topic_Allocation of at least the Coverage_Floor, subject to Requirement 4 Acceptance Criterion 2.
5. FOR ALL valid inputs under `weak_weighted`, THE Selection_Core SHALL never assign a strictly weaker Topic a smaller Topic_Allocation than a strictly stronger Topic, except where the Coverage_Floor or candidate availability forces otherwise.
6. FOR ALL valid inputs, THE Selection_Core SHALL return only distinct question ids drawn from the supplied candidate pools.
7. FOR ALL valid inputs where total available candidates are greater than or equal to the session total, THE Selection_Core SHALL return exactly the session total number of question ids.
