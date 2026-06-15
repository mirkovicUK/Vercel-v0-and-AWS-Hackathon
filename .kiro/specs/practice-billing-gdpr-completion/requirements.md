# Requirements Document

## Introduction

ApexMaths is a UK 11+ maths practice subscription product built on Next.js 16 (App Router), deployed to Vercel serverless. It uses Amazon Cognito for identity, Amazon Aurora PostgreSQL (via the RDS Data API, `lib/aws/rds-data.ts`) for data, Amazon Bedrock Nova 2 Lite (via `lib/ai/model.ts`) for AI, and Stripe for payments.

This feature completes the product so its behaviour matches a working sibling reference implementation (originally built on Firebase/Firestore/Gemini/Cloud Run, documented in `instructions.me`). The reference's *behaviour* is the target; its *technology choices are not* — every requirement here targets the existing Aurora/Cognito/Stripe/Bedrock stack and MUST NOT introduce Firebase, Firestore, Gemini, Cloud Run, background queues, or cron.

The work is organised into four tiers plus two cross-cutting changes:

- **Tier 1** — Trial-abuse prevention and a one-active-session-per-child guard.
- **Tier 2** — Per-session AI review generated synchronously within the completing request (the marquee feature).
- **Tier 3** — Revenue tracking from `invoice.paid` with strict status-transition isolation and webhook idempotency.
- **Tier 4** — GDPR hard-delete (true erasure across Stripe, Aurora, and Cognito).
- **Cross-cutting A** — Stripe Embedded Checkout.
- **Cross-cutting B** — Domain reconciliation (year groups Year 4–6; mastery thresholds).

### Architectural Context (constraints that shape requirements)

- Vercel serverless functions **freeze CPU once the HTTP response is sent**, so any AI work for the per-session review MUST complete *within* the request that completes the session. Fire-and-forget background work is not viable on this platform (the reference learned this on Cloud Run).
- The "answer firewall" (`correctIndex` never sent to the client mid-session) and the existing PII firewall (only question text/options/imageDescription and a child's year group may reach the model) MUST be preserved.
- All id and foreign-key columns are `TEXT` (see `scripts/sql/001_schema.sql`); no requirement may reintroduce the `uuid` column type.

### Out of Scope

- THE Feature SHALL NOT change the core Cognito auth flow (sign-up, email verification, password reset, sessions).
- THE Feature SHALL NOT change the answer firewall (the rule that `correctIndex` is never serialised to the client during an active session).
- THE Feature SHALL NOT change AWS infrastructure or CDK beyond the schema migrations these features require (notably the `has_used_trial` column and any review-status columns); such migrations SHALL be noted as schema changes.
- THE Feature SHALL NOT switch away from Aurora, Cognito, or Bedrock, and SHALL NOT introduce background queues or scheduled jobs; the per-session review is synchronous by design decision.

## Glossary

- **System**: The ApexMaths application as a whole (Next.js server actions, API routes, and data layer).
- **Checkout_Service**: The server action that creates a Stripe Checkout session (`app/(app)/billing/actions.ts`, `startSubscriptionCheckout`).
- **Stripe_Webhook**: The Stripe webhook handler route (`app/api/stripe/webhook/route.ts`).
- **Practice_Service**: The server actions managing practice sessions (`app/(app)/practice/actions.ts`).
- **Review_Service**: The component that generates a per-session results review using Amazon Bedrock Nova 2 Lite.
- **Account_Service**: The server action handling GDPR export and account deletion (`app/(app)/account/actions.ts`).
- **Parent**: A subscriber account; `parents` row keyed by the Cognito `sub`.
- **Child**: A learner profile owned by a Parent (max 3 per Parent).
- **Practice_Session**: A timed set of questions for a Child (`warmup` | `topic` | `mock`).
- **Review_Report**: The per-session review stored once per session in the `review_reports` table.
- **Has_Used_Trial**: A server-only boolean on the Parent record recording whether a free trial has ever been started.
- **Active_Session**: A `Practice_Session` whose status is `active` and whose `expires_at` is in the future.
- **Revenue_Event**: A record in `revenue_events` capturing one paid invoice.
- **Revenue_Summary**: A materialised aggregate of total revenue, paying-parent count, and first-paid timestamp.
- **Trial_Eligibility**: The server-side decision of whether a new checkout grants a 7-day trial.
- **PII_Firewall**: The rule restricting model inputs to question text, options, `imageDescription`, and the Child's year group, excluding all identifiers and personal data.
- **Mastery_Classification**: A per-topic label: `strong`, `developing`, `needs_focus`, or `insufficient_data`.
- **Year_Group**: A Child's school year, constrained to Year 4, Year 5, or Year 6.

---

## Requirements

## Tier 1 — Trial-Abuse Prevention and One-Active-Session Guard

### Requirement 1: Persist trial usage on the Parent record

**User Story:** As the business, I want to record whether a parent has ever started a free trial, so that the same person cannot obtain repeated free trials by cancelling and resubscribing.

#### Acceptance Criteria

1. THE System SHALL provide a server-only `has_used_trial` boolean column on the `parents` table, defaulting to `FALSE`.
2. THE System SHALL expose `has_used_trial` only to server-side code and SHALL NOT serialise it to any client response.
3. THE System SHALL treat the addition of `has_used_trial` as a schema migration applied to the existing Aurora schema.
4. WHILE reading or writing a Parent record, THE System SHALL use `has_used_trial` as the authoritative local record of prior trial usage.

### Requirement 2: Decide trial eligibility at checkout

**User Story:** As the business, I want checkout to grant a trial only to genuinely new customers, so that trial abuse is prevented while first-time users still get a trial.

#### Acceptance Criteria

1. WHEN the Checkout_Service creates a Checkout session AND the Parent's `has_used_trial` is `TRUE`, THE Checkout_Service SHALL create the session without a trial period.
2. WHEN the Checkout_Service creates a Checkout session AND `has_used_trial` is `FALSE` AND the Parent has an existing Stripe customer id, THE Checkout_Service SHALL query Stripe subscriptions with `status: 'all'` for that customer AND, IF at least one prior subscription exists, THEN create the session without a trial period; this decision takes precedence over Acceptance Criterion 3.
3. WHEN the Checkout_Service creates a Checkout session AND `has_used_trial` is `FALSE` AND either no Stripe customer id exists or the Stripe query returns no prior subscription, THE Checkout_Service SHALL create the session with a 7-day trial via `subscription_data.trial_period_days`.
4. IF the Stripe subscription lookup fails, THEN THE Checkout_Service SHALL treat the failure as non-fatal and SHALL grant a 7-day trial whenever `has_used_trial` is `FALSE`, deciding Trial_Eligibility from `has_used_trial` alone and disregarding any cached or other subscription indicators.
5. THE Checkout_Service SHALL NOT write subscription status during checkout creation.

### Requirement 3: Set trial usage from webhook trial events

**User Story:** As the business, I want the system to remember a trial as soon as Stripe reports a trialing subscription, so that the trial flag cannot be bypassed.

#### Acceptance Criteria

1. WHEN the Stripe_Webhook processes a subscription event whose status is `trialing`, THE Stripe_Webhook SHALL set the corresponding Parent's `has_used_trial` to `TRUE`.
2. THE Stripe_Webhook SHALL NOT set `has_used_trial` back to `FALSE` for any event, under any circumstance, including error handling or correction; once `TRUE`, the value SHALL remain `TRUE` permanently.
3. WHEN the Stripe_Webhook sets `has_used_trial` to `TRUE` for a Parent already marked `TRUE`, THE Stripe_Webhook SHALL leave the value `TRUE` (idempotent).

### Requirement 4: Enforce one active session per child

**User Story:** As a parent, I want only one practice session active per child at a time, so that progress and grading stay consistent and a child cannot run overlapping sessions.

#### Acceptance Criteria

1. WHEN the Practice_Service receives a request to start a Practice_Session for a Child that already has an Active_Session, THE Practice_Service SHALL reject the new session and SHALL NOT create a second Active_Session.
2. WHEN the Practice_Service rejects a start request due to an existing Active_Session, THE Practice_Service SHALL return the existing Active_Session identifier and offer the options to resume or to end the existing session.
3. WHEN the Practice_Service receives a request to start a Practice_Session for a Child whose only prior sessions are `completed`, `expired`, or `abandoned`, THE Practice_Service SHALL create the new session.
4. WHILE determining whether an Active_Session exists, THE Practice_Service SHALL treat a session whose `expires_at` has passed as not active.
5. WHEN the Parent chooses to end the existing Active_Session, THE Practice_Service SHALL transition that session to a terminal status before permitting a new session to start.

---

## Tier 2 — Per-Session AI Review (Synchronous)

### Requirement 5: Generate a results review on session completion

**User Story:** As a parent, I want a results review when my child finishes a session, so that I can see how they did per topic and understand each mistake.

#### Acceptance Criteria

1. WHEN a Practice_Session is completed, THE Review_Service SHALL compute a deterministic per-topic correct/attempted summary from the recorded answers.
2. WHEN a Practice_Session is completed, THE Review_Service SHALL determine the strongest topic and the weakest topic deterministically, breaking ties alphabetically.
3. IF fewer than 2 topics have at least one attempted answer, THEN THE Review_Service SHALL set the weakest topic to `n/a`.

> Clarification: the weakest topic is `n/a` only when fewer than 2 topics have attempts. When exactly 2 (or more) topics have attempts, the weakest topic is always determined, and a tie is broken alphabetically per Acceptance Criterion 2 (a tie does not produce `n/a`).

4. WHEN a completed Practice_Session contains at least one incorrect answer, THE Review_Service SHALL generate, for each incorrect answer, an AI explanation and a suggested next step.
5. WHEN a completed Practice_Session contains zero incorrect answers, THE Review_Service SHALL produce a deterministic Review_Report and SHALL NOT invoke the model.
6. IF AI generation fails or is unavailable for any incorrect answer, THEN THE Review_Service SHALL still complete the session and produce the Review_Report using deterministic fallback text for the affected explanations, and SHALL NOT block, queue, or defer session completion.
7. THE Review_Service SHALL store exactly one Review_Report per session in the existing `review_reports` table.
8. THE Review_Service SHALL record whether a Review_Report was produced by the model or by the deterministic fallback via the `generated_by` field (`nova` or `fallback`).

### Requirement 6: Generate the review synchronously within the completing request

**User Story:** As a parent on a serverless-hosted product, I want the review generated reliably, so that I always receive a usable report even though the platform freezes background work.

#### Acceptance Criteria

1. THE Review_Service SHALL generate the Review_Report synchronously within the same request that completes the Practice_Session, and SHALL NOT defer generation to a fire-and-forget background task, a queue, or a scheduled job.
2. THE System SHALL compute and persist the score and per-topic summary synchronously within the completing request, before any AI work begins, so that an AI failure or timeout cannot lose them, and SHALL NOT use any background processing to guarantee their persistence.
3. WHEN AI generation does not complete within the configured time budget, THE Review_Service SHALL persist a completed Review_Report using deterministic fallback text for any unfinished explanations.
4. THE System SHALL ensure the Parent receives the score and a usable Review_Report on every completed session.

### Requirement 7: Preserve the PII firewall in review generation

**User Story:** As a data controller, I want the review to send only non-identifying content to the model, so that child and parent personal data never leaves the trust boundary.

#### Acceptance Criteria

1. WHEN the Review_Service builds a model prompt, THE Review_Service SHALL include only question text, question options, question `imageDescription`, and the Child's Year_Group.
2. THE Review_Service SHALL NOT include a Child's display name, a Parent's email, or any identifier (parent id, child id, session id, Stripe id) in any model prompt.
3. THE Review_Service SHALL NOT send a question's `imageUrl` to the model.
4. THE Review_Service SHALL keep `imageDescription` server-only and SHALL NOT return `imageDescription` to the client under any circumstance.
5. WHERE a review item concerns an incorrect answer, THE Review_Service SHALL include the correct answer text in the model context for that item.

### Requirement 8: Latency and timeout safety for synchronous review (NFR)

**User Story:** As an operator, I want the synchronous review never to exceed the function's execution limit, so that completing a session never fails due to AI latency.

#### Acceptance Criteria

1. THE Review_Service SHALL issue the per-incorrect-answer model calls in parallel rather than sequentially.
2. THE Review_Service SHALL enforce a hard per-call timeout on each model call.
3. THE Review_Service SHALL enforce an overall time budget across all model calls for a single review.
4. IF a model call fails for any reason — including a per-call timeout, a network error, the service being unavailable, or a successful response that is empty or malformed — THEN THE Review_Service SHALL use deterministic fallback text for that call's explanation and next step.
5. WHEN a model call returns a successful response, THE Review_Service SHALL validate the response content and, IF the content is empty or malformed, THEN use deterministic fallback text for that call's explanation and next step.
6. IF the overall time budget is exceeded, THEN THE Review_Service SHALL stop awaiting further model calls and finalise the Review_Report with deterministic fallback text for any unfinished items.
7. THE completing route SHALL declare a `maxDuration` greater than the overall AI time budget plus the time to compute and persist the score and summary.
8. THE overall time budget SHALL be set so that the total request duration remains within the route's `maxDuration`.
9. IF every model call fails, THEN THE Review_Service SHALL persist a deterministic fallback Review_Report and mark it `generated_by = 'fallback'`.

---

## Tier 3 — Revenue Tracking via `invoice.paid`

### Requirement 9: Record revenue from paid invoices

**User Story:** As the business, I want each paid invoice recorded, so that I can track total revenue and the number of paying parents.

#### Acceptance Criteria

1. WHEN the Stripe_Webhook receives an `invoice.paid` event with `amount_paid` greater than 0, THE Stripe_Webhook SHALL record a Revenue_Event in the `revenue_events` table.
2. THE Stripe_Webhook SHALL make Revenue_Event recording idempotent on the Stripe invoice id, so the same invoice is recorded at most once.
3. IF an `invoice.paid` event references an invoice id that has already been recorded as a Revenue_Event, THEN THE Stripe_Webhook SHALL skip the recording attempt entirely based on the invoice id, without validating `amount_paid` for the duplicate.
4. IF an `invoice.paid` event has `amount_paid` less than or equal to 0, THEN THE Stripe_Webhook SHALL skip revenue recording for that invoice.
5. WHEN recording a Revenue_Event, THE Stripe_Webhook SHALL store the amount in pence, the currency, the associated Parent, and the paid timestamp.

### Requirement 10: Maintain a revenue summary

**User Story:** As the business, I want a running revenue summary, so that totals are available without re-aggregating every invoice.

#### Acceptance Criteria

1. WHEN a Revenue_Event is recorded, THE Stripe_Webhook SHALL accumulate the invoice amount into the Revenue_Summary total revenue.
2. WHEN a Revenue_Event is recorded for a Parent that has no prior Revenue_Event, THE Stripe_Webhook SHALL increment the paying-parent count by one.
3. WHEN a Revenue_Event is recorded for a Parent that already has a prior Revenue_Event, THE Stripe_Webhook SHALL NOT increment the paying-parent count.
4. WHEN the first Revenue_Event overall is recorded, THE Stripe_Webhook SHALL set the Revenue_Summary first-paid timestamp once and SHALL NOT overwrite it on subsequent events.

### Requirement 11: Isolate status transitions from invoice events

**User Story:** As the business, I want subscription status changes driven solely by subscription events, so that the trialing→active boundary is never corrupted by invoice handling.

#### Acceptance Criteria

1. WHEN the Stripe_Webhook processes an `invoice.paid` event, THE Stripe_Webhook SHALL NOT modify any subscription status.
2. THE Stripe_Webhook SHALL change subscription status only in response to `customer.subscription.created`, `customer.subscription.updated`, or `customer.subscription.deleted` events.

### Requirement 12: Webhook idempotency (NFR)

**User Story:** As an operator, I want duplicate webhook deliveries handled safely, so that retried events never double-count revenue or corrupt state.

#### Acceptance Criteria

1. WHEN the Stripe_Webhook receives an event whose id is already recorded in the processed-events guard (`processed_webhook_events`), THE Stripe_Webhook SHALL acknowledge the delivery with a success response and SHALL NOT process it again.
2. WHEN the Stripe_Webhook processes a new event, THE Stripe_Webhook SHALL record the event id in the processed-events guard so subsequent duplicate deliveries are detected.
3. IF processing a webhook event throws an error, THEN THE Stripe_Webhook SHALL respond with a 500 status so Stripe retries delivery, and SHALL NOT leave a processed-events marker that would suppress the retry.
4. WHEN the Stripe_Webhook cannot verify the Stripe signature, THE Stripe_Webhook SHALL reject the request with a 400 status.

---

## Tier 4 — GDPR Hard-Delete

### Requirement 13: Erase the Stripe footprint on account deletion

**User Story:** As a parent exercising my right to erasure, I want my payment records cancelled and removed, so that no billing relationship remains.

#### Acceptance Criteria

1. WHEN account deletion is confirmed, THE Account_Service SHALL cancel any active, trialing, or past-due Stripe subscriptions for the Parent before deleting other data.
2. WHEN account deletion is confirmed AND the Parent has a Stripe customer id, THE Account_Service SHALL delete the Stripe customer.
3. IF any error occurs during the deletion process — including a Stripe failure, a network timeout, or any other error — THEN THE Account_Service SHALL abort the deletion and leave the account intact so the Parent can retry.

### Requirement 14: Hard-delete all owned data from Aurora

**User Story:** As a parent exercising my right to erasure, I want all of my data permanently removed, so that nothing personal is retained.

#### Acceptance Criteria

1. WHEN account deletion is confirmed AND the Stripe erasure has succeeded, THE Account_Service SHALL hard-delete the Parent row from Aurora.
2. WHEN the Parent row is hard-deleted, THE System SHALL delete all owned children, sessions, answers, progress, subscription, and review reports via the existing cascading foreign keys.
3. THE Account_Service SHALL NOT leave any soft-deleted residue of the Parent's personal data after a confirmed hard-delete.

### Requirement 15: Delete the Cognito user and free the email

**User Story:** As a parent who deleted my account, I want my email freed, so that I can register again later.

#### Acceptance Criteria

1. WHEN the Aurora data has been hard-deleted, THE Account_Service SHALL delete the Cognito user so the email becomes available for re-registration.
2. IF deleting the Cognito user fails, THEN THE Account_Service SHALL log the failure and treat it as non-fatal, allowing the overall deletion to complete.

### Requirement 16: Retain an append-only deletion audit record

**User Story:** As a data controller, I want evidence that an erasure occurred, so that I can demonstrate compliance.

#### Acceptance Criteria

1. WHEN an account deletion proceeds, THE Account_Service SHALL write an append-only audit record — retaining the Parent uid, email, and Stripe customer id as compliance evidence — successfully before the erasure proceeds.
2. IF the deletion audit record cannot be written successfully, THEN THE Account_Service SHALL abort the deletion and SHALL NOT erase any data.
3. THE Account_Service SHALL NOT include child personal data in the deletion audit record.

> Design note: writing the audit record first means the audit precedes the Stripe/Aurora/Cognito erasure ordering in Requirements 13–15; the design phase will reconcile this sequencing (e.g., audit write as the first step of the deletion transaction/sequence).

### Requirement 17: Confirm deletion before erasing

**User Story:** As a parent, I want a deliberate confirmation step before erasure, so that I do not delete my account by accident.

#### Acceptance Criteria

1. THE Account_Service SHALL require an explicit confirmation before performing erasure, using a single confirmation mechanism chosen for this app.
2. WHEN the confirmation input does not match the required value, THE Account_Service SHALL reject the deletion and SHALL NOT erase any data.
3. WHERE the chosen mechanism is a typed confirmation, THE Account_Service SHALL require the Parent to type `DELETE` to confirm, and SHALL treat that typed confirmation as required before erasing any data.

> Design note: the typed `DELETE` confirmation is the selected default mechanism for this app. The reference's two-step 6-digit token with a 15-minute expiry remains a design option, but unless the design phase decides otherwise, the active mechanism is the typed `DELETE` confirmation.

---

## Cross-Cutting A — Stripe Embedded Checkout

### Requirement 18: Use Stripe Embedded Checkout

**User Story:** As a parent, I want to complete checkout inside the app, so that I am not redirected away to a hosted page.

#### Acceptance Criteria

1. IF Stripe is configured, THEN THE Checkout_Service SHALL create the Checkout session with `ui_mode: 'embedded'` and SHALL return the session `client_secret` to the client.
2. WHEN a `client_secret` is available, THE System SHALL render checkout on the client using `EmbeddedCheckoutProvider` and `EmbeddedCheckout` from `@stripe/react-stripe-js`, initialised with the returned `client_secret`; IF no `client_secret` is available, THEN THE System SHALL prevent rendering the embedded checkout and SHALL display an error message instead.
3. THE Checkout_Service SHALL configure a `return_url` so the customer is redirected back into the app on completion.
4. WHEN a checkout completes, THE System SHALL route the Parent to the billing page reflecting completion; IF routing to the billing page fails, THEN THE System SHALL automatically retry routing or provide a fallback navigation method so the Parent is not left without a path forward.
5. WHEN the Checkout_Service creates the embedded session, THE Checkout_Service SHALL apply the Trial_Eligibility decision from Requirement 2.
6. IF Stripe is not configured, THEN THE Checkout_Service SHALL return no client secret and a message indicating billing is unavailable.

> Implementation note: `app/(app)/billing/actions.ts` currently passes `ui_mode: "embedded_page"` (not a valid Stripe value) and always sets `trial_period_days`; both must be corrected under this requirement and Requirement 2.

---

## Cross-Cutting B — Domain Reconciliation

### Requirement 19: Constrain year groups to Year 4–6

**User Story:** As a product owner, I want year groups aligned to the 11+ cohort, so that the data matches the reference and the curriculum scope.

#### Acceptance Criteria

1. THE System SHALL constrain a Child's Year_Group to one of Year 4, Year 5, or Year 6.
2. WHEN a Parent adds or edits a Child, THE System SHALL offer only Year 4, Year 5, and Year 6 as selectable year groups.
3. IF a Child record is submitted with a year group outside Year 4–6, THEN THE System SHALL reject the submission.
4. THE System SHALL treat the narrowing of the `year_group` constraint (currently 3–8 in the schema, 3–7 in the add-child UI) as a schema and UI change.

### Requirement 20: Pin the mastery classification thresholds

**User Story:** As a parent, I want consistent mastery labels, so that progress reporting is meaningful and matches the reference.

#### Acceptance Criteria

1. WHEN a topic's attempted-answer count is at or above the minimum-attempts threshold AND mastery is at or above 0.8 (80%), THE System SHALL classify the topic as `strong`.
2. WHEN a topic's attempted-answer count is at or above the minimum-attempts threshold AND mastery is at or above 0.5 (50%) but below 0.8, THE System SHALL classify the topic as `developing`.
3. WHEN a topic's attempted-answer count is at or above the minimum-attempts threshold AND mastery is below 0.5, THE System SHALL classify the topic as `needs_focus`.
4. IF a topic's attempted-answer count is below the minimum-attempts threshold, THEN THE System SHALL classify the topic as `insufficient_data`, regardless of any mastery score; this classification takes absolute precedence over the `strong`, `developing`, and `needs_focus` classifications in Acceptance Criteria 1–3.
5. THE System SHALL define the minimum-attempts threshold as a single pinned constant used by all mastery classification logic.

> Implementation note: the current `classifyMastery` uses 75/50 cut-points and lacks `insufficient_data`; the threshold pinning here moves `strong` to ≥0.8 and adds the `insufficient_data` band. The design phase will reconcile the stored `mastery_classification` enum (which lacks `insufficient_data`) with this requirement.
