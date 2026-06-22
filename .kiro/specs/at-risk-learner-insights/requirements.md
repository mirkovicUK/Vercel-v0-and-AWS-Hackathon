# Requirements Document

## Introduction

At-Risk Learner Insights adds an operator-only, **read-only** "lifecycle & at-risk" view to the existing ApexMaths admin dashboard at the route `/admin`. It surfaces actionable learner cohorts derived from the existing Aurora PostgreSQL schema, so operators can support learners and reduce churn. The view is an extension of the already-shipped admin dashboard and reuses its authorization, data-access, resilience, and UI patterns; it introduces no new infrastructure and no new authentication mechanism.

Two cohorts ship in v1:

1. **Children with declining mastery** — children whose recent mastery trend is negative, computed by scaling up the app's existing relational analytics (the per-child improvement-velocity / mastery-over-time logic in `lib/db/analytics.ts`) into a single cohort query across all children.
2. **Trials ending soon** — parents whose subscription is `trialing` with a `trial_end` within the next N days (default 3), computed with a single `subscriptions` query joined to `parents`.

### Deliberate, documented PII exception

The admin dashboard v1 was intentionally aggregate-only with **no Child_PII**. This feature introduces a **deliberate, documented exception** on a legitimate-interest basis of **operational support and safeguarding of the learning experience**. For this surface only:

- Admins MAY view full Parent account data, **including the parent email address**.
- Admins MAY view a child's **display name / nickname only** — the only child identifier the app collects. No other child PII exists in the schema (no date of birth, no school, no contact details).
- Admins MUST NOT be shown any child data beyond the child display name and the already-permitted aggregate progress metrics (for example mastery score and topic). No question correct-answers, no `stripe_customer_id`, and no Cognito `sub` are exposed.

This exception applies **only to the At-Risk Learner Insights surface** and supersedes the admin-dashboard v1 "no Child_PII" rule (admin-dashboard Requirements 7.5 and 12.3) for this surface, on the documented support-and-safeguarding basis above. All other admin-dashboard privacy rules continue to apply unchanged.

Authorization, read-only operation, single-query analytics, UI integration, and per-section resilience all reuse the existing admin-dashboard mechanisms: the `requireAdmin()` guard (fail-closed, HTTP 404), the RDS Data API `SELECT`-only helpers (`lib/aws/rds-data.ts`), the `MetricSection` collapsible-card pattern (`components/app/admin/`), and the `SettledSection` per-section failure isolation pattern.

### Out of scope for v1

- The parent-contact inbox (a separate spec, "parent-contact-inbox").
- Any write, mutation, outbound email, or notification. This view only **displays** cohorts; acting on them is manual and out-of-band for v1.

## Glossary

- **Admin**: An authenticated Parent whose verified Cognito ID token contains the value `admins` in its `cognito:groups` claim (as defined by the admin-dashboard spec).
- **Admin_Guard**: The existing server-side guard `requireAdmin()` in `lib/auth/guard.ts` that authorizes Admin-only surfaces, fails closed, and responds with HTTP status 404 on denial.
- **Admin_Dashboard**: The existing server-rendered page at `/admin` into which this view is integrated.
- **Insights_Service**: The server-side module that computes the At-Risk Learner Insights cohorts via the RDS Data API for the Admin_Dashboard.
- **RDS_Data_Helpers**: The existing query helpers in `lib/aws/rds-data.ts` (`query`, `queryOne`) used for `SELECT`-only reads.
- **Existing_Analytics**: The existing per-child relational analytics in `lib/db/analytics.ts`, specifically `getImprovementVelocity` (session-over-session cumulative-accuracy delta via `LAG()`) and `getMasteryTimeline` (running cumulative accuracy via window functions), plus the `progress` rollup table.
- **Parent**: An authenticated end user of ApexMaths, keyed by their Cognito `sub`, represented by a row in the `parents` table.
- **Child**: A learner record in the `children` table, owned by a Parent; the only child identifier collected is `display_name`.
- **MetricSection**: The existing collapsible card component in `components/app/admin/` used to render a titled admin metric section.
- **SettledSection**: The existing per-section result wrapper (`{ ok: true, data } | { ok: false, error }`) that allows one section to fail without blanking the dashboard.
- **Declining_Mastery_Child**: A Child whose Recent_Mastery_Slope is strictly negative, computed over the Mastery_Trend_Window, who has at least Min_Completed_Sessions completed sessions.
- **Recent_Mastery_Slope**: The signed change in a Child's running cumulative accuracy across recent completed sessions, computed in the engine using `LAG()` over running cumulative correct/attempts (over `sessions` joined to `session_answers`). A negative value indicates declining mastery.
- **Mastery_Trend_Window**: The number of most-recent completed sessions per Child over which the Recent_Mastery_Slope is computed. Default value: 5 most-recent completed sessions.
- **Min_Completed_Sessions**: The minimum number of completed sessions a Child must have for the Recent_Mastery_Slope to be considered meaningful. Default value: 2.
- **Trial_Ending_Cohort**: The set of Parents whose subscription `status` is `trialing` and whose `trial_end` falls within the Trial_Ending_Window.
- **Trial_Ending_Window**: The forward-looking time window `[now, now + N days]` used to select trials ending soon. Default value: N = 3 days.
- **Days_Remaining**: The whole number of days from `now` until a subscription's `trial_end`, displayed for each member of the Trial_Ending_Cohort.
- **Cohort_Row_Limit**: An explicit maximum number of rows returned by each cohort query, bounding query cost. Default value: 50.
- **Child_PII**: Any data that identifies or describes a Child. For this surface, the only Child_PII permitted is the Child's `display_name`.
- **Subscription_Status**: A value of the `subscription_status` enum: `trialing`, `active`, `past_due`, `canceled`, `incomplete`, `unpaid`.

## Requirements

### Requirement 1: Authorize every insights surface through the existing admin guard

**User Story:** As a security owner, I want the at-risk insights view to use the same admin authorization as the rest of `/admin`, so that no new access path is introduced and unauthorized users cannot reach or reveal learner data.

#### Acceptance Criteria

1. WHEN any page that renders At-Risk Learner Insights is requested, THE Admin_Dashboard SHALL invoke the Admin_Guard and obtain an authorization decision before computing, fetching, or rendering any cohort data.
2. WHEN any data fetch or server action that returns At-Risk Learner Insights cohort data is invoked, THE Insights_Service SHALL execute its cohort computation only after the Admin_Guard has returned an authorized decision for that same request.
3. IF the Admin_Guard denies access, THEN THE system SHALL return HTTP status 404 and SHALL NOT compute, fetch, or return any cohort data or any indication that cohort data exists.
4. IF the Admin_Guard fails to return a decision or returns an error, THEN THE system SHALL deny access by returning HTTP status 404 without computing, fetching, or returning any cohort data.
5. THE Insights_Service SHALL NOT introduce, expose, or honor any authorization mechanism other than the existing Admin_Guard.
6. WHEN the At-Risk Learner Insights view is requested, THE Admin_Dashboard SHALL render it dynamically per request and SHALL NOT serve statically cached cohort values.

### Requirement 2: Compute the declining-mastery cohort by reusing existing analytics

**User Story:** As an Admin, I want to see which children show a recent negative mastery trend, so that I can support learners before they disengage.

#### Acceptance Criteria

1. WHEN an authorized Admin loads the At-Risk Learner Insights view, THE Insights_Service SHALL compute the declining-mastery cohort using the same relational analytics approach as Existing_Analytics, scaled across all children in a single aggregate query rather than computed row-by-row in application code.
2. THE Insights_Service SHALL compute each Child's Recent_Mastery_Slope in the engine using a window function over running cumulative accuracy across that Child's completed sessions, restricted to the most-recent sessions defined by the Mastery_Trend_Window (default 5 most-recent completed sessions).
3. IF a Child's Recent_Mastery_Slope is strictly negative AND that Child has at least Min_Completed_Sessions (default 2) completed sessions, THEN THE Insights_Service SHALL classify that Child as a Declining_Mastery_Child.
4. IF a Child has fewer than Min_Completed_Sessions completed sessions, THEN THE Insights_Service SHALL exclude that Child from the declining-mastery cohort.
5. THE Insights_Service SHALL order the declining-mastery cohort by Recent_Mastery_Slope ascending (steepest declines first), with ties broken by a stable, unique, deterministic ordering key so the result order is reproducible across identical requests.
6. THE Insights_Service SHALL bound the declining-mastery cohort query with an explicit Cohort_Row_Limit (default 50), applied after the ascending ordering so that the steepest declines are the rows retained.

### Requirement 3: Display the declining-mastery cohort

**User Story:** As an Admin, I want each declining-mastery child presented with the minimum identifying detail, so that I can identify the learner and reach their parent for support.

#### Acceptance Criteria

1. WHEN the At-Risk Learner Insights view renders the declining-mastery cohort, THE Admin_Dashboard SHALL display exactly one row per Declining_Mastery_Child, up to the Cohort_Row_Limit, each row showing the Child's `display_name`.
2. WHEN the At-Risk Learner Insights view renders the declining-mastery cohort, THE Admin_Dashboard SHALL display, on the same row as each Declining_Mastery_Child, the owning Parent's email address.
3. WHEN the At-Risk Learner Insights view renders the declining-mastery cohort, THE Admin_Dashboard SHALL display, for each Declining_Mastery_Child, the Recent_Mastery_Slope as a numeric value carrying an explicit leading sign (a negative sign for a declining trend).
4. WHEN the At-Risk Learner Insights view renders the declining-mastery cohort, THE Admin_Dashboard SHALL order the displayed rows by Recent_Mastery_Slope ascending, so the steepest decline appears first.
5. THE Admin_Dashboard SHALL NOT display any Child data beyond the Child `display_name` and the permitted aggregate mastery metric (the Recent_Mastery_Slope).
6. THE Admin_Dashboard SHALL NOT display any question `text`, `options`, or `correct_index` for any Child in the declining-mastery cohort.
7. IF no Child qualifies as a Declining_Mastery_Child, THEN THE Admin_Dashboard SHALL display an empty-state message indicating that no children currently show a declining mastery trend.

### Requirement 4: Compute the trials-ending-soon cohort

**User Story:** As an Admin, I want to see which trials are ending soon, so that I can reach out to parents before conversion is lost.

#### Acceptance Criteria

1. WHEN an authorized Admin loads the At-Risk Learner Insights view, THE Insights_Service SHALL compute the Trial_Ending_Cohort using a single query over `subscriptions` joined to `parents`, evaluated against one request-time reference instant `now` that is held constant for the entire cohort computation.
2. IF a subscription's `status` is `trialing` AND its `trial_end` satisfies `now <= trial_end <= now + N days` (inclusive of both bounds, where N defaults to 3 days), THEN THE Insights_Service SHALL include that subscription in the Trial_Ending_Cohort.
3. IF a subscription's `trial_end` is strictly before `now` (`trial_end < now`), THEN THE Insights_Service SHALL exclude that subscription from the Trial_Ending_Cohort.
4. THE Insights_Service SHALL order the Trial_Ending_Cohort by `trial_end` ascending (soonest-ending first), with ties broken by a stable, unique, deterministic ordering key so the result order is reproducible across identical requests.
5. THE Insights_Service SHALL bound the Trial_Ending_Cohort query with an explicit Cohort_Row_Limit (default 50), applied after the ascending `trial_end` ordering so that the soonest-ending trials are the rows retained.

### Requirement 5: Display the trials-ending-soon cohort

**User Story:** As an Admin, I want each ending trial shown with the parent contact and time remaining, so that I can prioritize outreach.

#### Acceptance Criteria

1. WHEN the At-Risk Learner Insights view renders the Trial_Ending_Cohort, THE Admin_Dashboard SHALL display, for each member, the Parent's email address.
2. WHEN the At-Risk Learner Insights view renders the Trial_Ending_Cohort, THE Admin_Dashboard SHALL display, for each member, the Days_Remaining until `trial_end` as a non-negative whole number of days, rounded up to the next whole day.
3. WHEN the At-Risk Learner Insights view renders the Trial_Ending_Cohort, THE Admin_Dashboard SHALL order the displayed rows by `trial_end` ascending, so the member with the fewest Days_Remaining appears first.
4. THE Admin_Dashboard SHALL NOT display the Parent's `stripe_customer_id` or Cognito `sub` for any member of the Trial_Ending_Cohort.
5. THE Admin_Dashboard SHALL NOT display any Parent attribute other than the email address and the Days_Remaining for any member of the Trial_Ending_Cohort.
6. IF the Trial_Ending_Cohort has zero members, THEN THE Admin_Dashboard SHALL display an empty-state message indicating that no trials are ending within the Trial_Ending_Window (the next N days, default 3).

### Requirement 6: Read-only operation

**User Story:** As a product owner, I want the at-risk insights view to be strictly read-only, so that operators cannot mutate learner or subscription data from the view.

#### Acceptance Criteria

1. THE Insights_Service SHALL issue only read-only `SELECT` statements against Aurora via the RDS_Data_Helpers AND SHALL NOT issue any `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `UPSERT`, or data-definition (DDL) statement.
2. THE At-Risk Learner Insights view SHALL expose only operations that read and display cohort data AND SHALL NOT expose any operation that creates, updates, or deletes stored data.
3. THE At-Risk Learner Insights view SHALL NOT present any control (button, form, link, menu action, or equivalent) that creates, updates, or deletes any Parent, Child, subscription, session, session_answer, or question record.
4. THE At-Risk Learner Insights view SHALL NOT trigger any outbound email, push notification, SMS, or other outbound message to any Parent, Child, or external recipient.
5. WHEN an Admin loads or interacts with the At-Risk Learner Insights view, THE Insights_Service SHALL leave every Parent, Child, subscription, session, session_answer, and question record unchanged.

### Requirement 7: Privacy and PII discipline for the at-risk surface

**User Story:** As a data-protection owner, I want the documented PII exception encoded precisely, so that the surface exposes exactly the permitted support-and-safeguarding data and nothing more.

#### Acceptance Criteria

1. WHEN the At-Risk Learner Insights view renders Parent data, THE view SHALL limit the displayed Parent PII to the Parent email address.
2. THE At-Risk Learner Insights view SHALL NOT display the Parent's Cognito `sub` or `stripe_customer_id`.
3. WHEN the At-Risk Learner Insights view renders Child data, THE view SHALL limit the displayed Child_PII to the Child `display_name`.
4. THE At-Risk Learner Insights view SHALL NOT display any question `text`, `options`, or `correct_index`.
5. THE At-Risk Learner Insights view SHALL NOT display any Child attribute other than `display_name` and the mastery metrics permitted by Requirement 3 (the Recent_Mastery_Slope).
6. THE At-Risk Learner Insights view SHALL apply the documented support-and-safeguarding PII exception only to this surface.
7. THE At-Risk Learner Insights view SHALL NOT alter the PII discipline of any other admin-dashboard surface.

### Requirement 8: Reuse analytics building blocks and bound query cost

**User Story:** As an Admin, I want the insights view to load efficiently using the existing analytics primitives, so that cohorts are available without slow or duplicated logic.

#### Acceptance Criteria

1. THE Insights_Service SHALL compute the mastery trend using the existing cumulative-accuracy window-function and `LAG()` delta logic from Existing_Analytics and the `progress` rollup, AND SHALL NOT introduce a separate or parallel mastery-trend implementation.
2. THE Insights_Service SHALL compute each cohort with exactly one SQL statement that performs its aggregation and window computation in the database engine, rather than fetching individual rows into the application and computing the cohort in application code.
3. THE Insights_Service SHALL bound each cohort query with an explicit Cohort_Row_Limit (default 50), such that no cohort query returns more than Cohort_Row_Limit rows.
4. IF the number of qualifying rows for a cohort exceeds the Cohort_Row_Limit, THEN THE Insights_Service SHALL return the first Cohort_Row_Limit rows according to that cohort's defined ordering.
5. WHEN the At-Risk Learner Insights cohorts are computed alongside the existing admin metrics, THE Insights_Service SHALL dispatch its independent cohort queries without waiting for the existing metric queries to complete, so the queries execute concurrently.

### Requirement 9: UI integration and per-section resilience

**User Story:** As an Admin, I want the insights cohorts to appear within the existing dashboard and degrade gracefully, so that a failure in one cohort does not blank the page.

#### Acceptance Criteria

1. WHEN the At-Risk Learner Insights view renders, THE Admin_Dashboard SHALL present the declining-mastery cohort and the Trial_Ending_Cohort each as a separate titled section using the existing MetricSection collapsible-card pattern.
2. IF a cohort query fails while rendering the At-Risk Learner Insights view, THEN THE Admin_Dashboard SHALL render the affected cohort's section, using the existing SettledSection pattern, with an error indication stating that the cohort could not be loaded.
3. IF a cohort query fails while rendering the At-Risk Learner Insights view, THEN THE Admin_Dashboard SHALL continue to render every other cohort section, the existing admin metric sections, and the remainder of the dashboard, such that no other section's content is removed or blanked.
4. WHERE the At-Risk Learner Insights view is shown, THE Admin_Dashboard SHALL render it only for a request authorized by the Admin_Guard, consistent with the existing admin navigation gating.
