# Requirements Document

## Introduction

The Admin Dashboard adds an internal, operator-only view to the ApexMaths app at the route `/admin`. It surfaces business and operational metrics derived from the existing Aurora PostgreSQL schema, with **revenue** as the marquee metric. Admins are existing parents who belong to a manually-created Amazon Cognito group named `admins`; they sign in through the exact same flow as normal parents, and the app determines admin status by reading the `cognito:groups` claim from the verified Cognito ID token.

For v1 the dashboard is strictly **read-only**: it presents aggregate metrics and the minimum supporting detail, with strong PII discipline (aggregate-first, no child PII, no leakage of question correct answers). Admin access is enforced **server-side** on every admin page and every admin data fetch, fails closed, and never trusts client-supplied identity. The implementation reuses existing platform patterns: server components plus guards, the RDS Data API query helpers (`lib/aws/rds-data.ts`), the existing revenue helper (`lib/db/revenue.ts`), and currency formatting (`lib/plans.ts` `formatPrice`).

## Glossary

- **Admin**: An authenticated Parent whose verified Cognito ID token contains the value `admins` in its `cognito:groups` claim.
- **Admins_Group**: A Cognito user-pool group named `admins`, created manually in the Cognito console, used as the sole source of admin authorization.
- **Parent**: An authenticated end user of ApexMaths, keyed by their Cognito `sub`, represented by a row in the `parents` table.
- **Session_Service**: The server module `lib/auth/session.ts` that verifies the Cognito ID token and returns its claims (`getVerifiedClaims`, `getCurrentClaims`, `getCurrentParent`).
- **Id_Claims**: The claims object returned by the Session_Service after verifying the ID token.
- **Admin_Guard**: A new server-side guard function `requireAdmin()` in `lib/auth/guard.ts` that authorizes Admin-only surfaces.
- **Admin_Dashboard**: The server-rendered page at the route `/admin` that displays admin metrics.
- **Metrics_Service**: The server-side module(s) that compute aggregate metrics via the RDS Data API for the Admin_Dashboard.
- **RDS_Data_Helpers**: The query helpers in `lib/aws/rds-data.ts` (`query`, `queryOne`, `withTransaction`).
- **Revenue_Summary**: The singleton aggregate `{ totalRevenuePence, payingParentCount, firstPaidAt }` returned by `getRevenueSummary()` in `lib/db/revenue.ts`.
- **Revenue_Event**: A row in the `revenue_events` table representing one paid invoice (`amount_pence`, `currency`, `occurred_at`, `parent_id`).
- **Subscription_Status**: A value of the `subscription_status` enum: `trialing`, `active`, `past_due`, `canceled`, `incomplete`, `unpaid`.
- **Session_Status**: A value of the `session_status` enum: `active`, `completed`, `expired`, `abandoned`.
- **PII**: Personally Identifiable Information.
- **Child_PII**: Any data that identifies or describes a child (a minor), including display name and year group.
- **Pence**: GBP minor currency units (integer), as stored in `amount_pence` / `total_revenue_pence`.

## Requirements

### Requirement 1: Expose Cognito group membership from the verified token

**User Story:** As the platform, I want the verified ID token claims to include the user's Cognito groups, so that admin status can be determined from a trusted server-side source.

#### Acceptance Criteria

1. WHEN the Session_Service verifies a Cognito ID token, THE Session_Service SHALL include the `cognito:groups` claim values in the returned Id_Claims as a list of group-name strings.
2. IF the verified ID token contains no `cognito:groups` claim, THEN THE Session_Service SHALL return an empty group list in the Id_Claims.
3. THE Session_Service SHALL continue to return the existing `sub` and `email` fields in the Id_Claims unchanged.
4. THE Session_Service SHALL derive group membership only from the cryptographically verified ID token payload.

### Requirement 2: Provide a server-side admin authorization guard

**User Story:** As an operator, I want a single reusable admin guard, so that every admin surface is protected consistently.

#### Acceptance Criteria

1. WHEN the Admin_Guard is invoked and the current request has a verified Id_Claims containing `admins` in its group list, THE Admin_Guard SHALL return the authenticated Admin identity to the caller.
2. IF the Admin_Guard is invoked and the current request has no valid verified session, THEN THE Admin_Guard SHALL deny access and respond with HTTP status 404.
3. IF the Admin_Guard is invoked and the verified Id_Claims group list does not contain `admins`, THEN THE Admin_Guard SHALL deny access and respond with HTTP status 404.
4. THE Admin_Guard SHALL determine authorization solely from the verified Id_Claims and SHALL NOT read any client-supplied identity, header, query parameter, or cookie value other than the verified session tokens.
5. WHEN the Admin_Guard denies access, THE Admin_Guard SHALL record an audit-log entry capturing the denial action and the requesting `sub`.

### Requirement 3: Enforce admin authorization on every admin surface

**User Story:** As a security owner, I want admin authorization enforced server-side on every admin page and data fetch, so that the admin area cannot be reached or revealed by unauthorized users.

#### Acceptance Criteria

1. WHEN any admin page under the `/admin` route is requested, THE Admin_Dashboard SHALL invoke the Admin_Guard before rendering any admin content.
2. WHEN any admin data fetch or server action that returns admin metrics is invoked, THE Metrics_Service SHALL invoke the Admin_Guard before reading or returning any data.
3. IF the Admin_Guard denies access for an admin page or admin data fetch, THEN THE system SHALL return HTTP status 404 without rendering or returning any admin metric values.
4. THE Admin_Dashboard SHALL be rendered dynamically per request and SHALL NOT serve statically cached metric values.

### Requirement 4: Display the revenue overview

**User Story:** As an Admin, I want to see headline revenue metrics, so that I can understand the business's paid performance at a glance.

#### Acceptance Criteria

1. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the total revenue obtained from the Revenue_Summary, formatted as GBP currency using the existing `formatPrice` function.
2. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the paying-parent count obtained from the Revenue_Summary.
3. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the first-paid date obtained from the Revenue_Summary.
4. IF the Revenue_Summary reports zero total revenue, THEN THE Admin_Dashboard SHALL display a total revenue of £0.00 and a paying-parent count of 0.
5. THE Metrics_Service SHALL obtain the revenue overview by calling the existing `getRevenueSummary()` helper.

### Requirement 5: Display recent paid invoices

**User Story:** As an Admin, I want to see the most recent paid invoices, so that I can verify recent payment activity.

#### Acceptance Criteria

1. WHEN an authorized Admin loads the Admin_Dashboard, THE Metrics_Service SHALL retrieve the 10 most recent Revenue_Events ordered by `occurred_at` descending.
2. WHEN displaying each recent Revenue_Event, THE Admin_Dashboard SHALL display the invoice amount formatted as GBP currency and the occurrence date.
3. WHERE a Revenue_Event has a non-null `parent_id`, THE Admin_Dashboard SHALL display the associated parent's email address as the only Parent PII shown for that invoice.
4. IF a Revenue_Event has a null `parent_id`, THEN THE Admin_Dashboard SHALL display the invoice as unattributed without inventing a parent identity.
5. IF no Revenue_Events exist, THEN THE Admin_Dashboard SHALL display an empty-state message indicating no paid invoices are recorded.

### Requirement 6: Display subscription metrics

**User Story:** As an Admin, I want subscription counts by status, so that I can monitor trials, active subscribers, and churn signals.

#### Acceptance Criteria

1. WHEN an authorized Admin loads the Admin_Dashboard, THE Metrics_Service SHALL compute the count of subscriptions grouped by each Subscription_Status value using a single aggregate query.
2. THE Admin_Dashboard SHALL display a count for each of the six Subscription_Status values: `trialing`, `active`, `past_due`, `canceled`, `incomplete`, and `unpaid`.
3. IF a Subscription_Status value has no matching subscriptions, THEN THE Admin_Dashboard SHALL display a count of 0 for that status.
4. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the count of subscriptions where `cancel_at_period_end` is true as the count of subscriptions set to cancel.

### Requirement 7: Display user metrics

**User Story:** As an Admin, I want to see how many parents and children exist and how signups are trending, so that I can track growth and account lifecycle.

#### Acceptance Criteria

1. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the total count of Parents where `deleted_at` is null as the count of active parent accounts.
2. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the count of Parents where `deleted_at` is not null as the count of soft-deleted accounts.
3. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the count of new Parent signups within the trailing 30 days computed from `parents.created_at`.
4. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the total count of children where `deleted_at` is null.
5. THE Admin_Dashboard SHALL NOT display any Child_PII, including child display names or year groups.

### Requirement 8: Display engagement metrics

**User Story:** As an Admin, I want practice-engagement metrics, so that I can understand how actively the product is used.

#### Acceptance Criteria

1. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the total count of sessions.
2. WHEN an authorized Admin loads the Admin_Dashboard, THE Metrics_Service SHALL compute the count of sessions grouped by each Session_Status value using a single aggregate query.
3. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the count of sessions started within the trailing 30 days computed from `sessions.started_at`.
4. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the count of review reports grouped by `generated_by` value (`nova` and `fallback`).
5. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the total AI hint usage computed as the sum of `sessions.help_used`.

### Requirement 9: Display content metrics

**User Story:** As an Admin, I want question-bank metrics, so that I can monitor content coverage without exposing answers.

#### Acceptance Criteria

1. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the total count of questions.
2. WHEN an authorized Admin loads the Admin_Dashboard, THE Metrics_Service SHALL compute the count of questions grouped by `topic` using a single aggregate query.
3. WHEN an authorized Admin loads the Admin_Dashboard, THE Admin_Dashboard SHALL display the count of questions where `active` is true and the count where `active` is false.
4. THE Admin_Dashboard SHALL NOT display any question's `correct_index`, `options`, or `text`.

### Requirement 10: Display operational health

**User Story:** As an Admin, I want recent operational activity, so that I can confirm webhooks and key actions are flowing.

#### Acceptance Criteria

1. WHEN an authorized Admin loads the Admin_Dashboard, THE Metrics_Service SHALL retrieve the 10 most recent processed webhook events ordered by `processed_at` descending.
2. WHEN displaying each processed webhook event, THE Admin_Dashboard SHALL display the event `type` and `processed_at` timestamp.
3. WHEN an authorized Admin loads the Admin_Dashboard, THE Metrics_Service SHALL retrieve the 20 most recent audit-log entries ordered by `created_at` descending.
4. WHEN displaying each audit-log entry, THE Admin_Dashboard SHALL display the `action` and `created_at` timestamp.
5. THE Admin_Dashboard SHALL NOT display the raw `detail` payload of an audit-log entry WHERE that payload could contain PII.

### Requirement 11: Read-only operation

**User Story:** As a product owner, I want the v1 admin dashboard to be read-only, so that there is no risk of operators mutating user data from the dashboard.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL provide only read operations over aggregate and summary data.
2. THE Metrics_Service SHALL execute only read (SELECT) statements against Aurora via the RDS_Data_Helpers.
3. THE Admin_Dashboard SHALL NOT provide any control that creates, updates, or deletes Parent, child, subscription, session, or question records.

### Requirement 12: Privacy and PII discipline

**User Story:** As a data-protection owner, I want the dashboard to minimise exposed PII, so that the admin area upholds the app's strong privacy posture.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL present metrics as aggregate counts and sums except where an individual record is explicitly permitted by these requirements.
2. WHERE Parent PII is displayed, THE Admin_Dashboard SHALL limit it to the parent email address and SHALL NOT display the Cognito `sub` or `stripe_customer_id`.
3. THE Admin_Dashboard SHALL NOT display any Child_PII.
4. THE Admin_Dashboard SHALL NOT display any question correct-answer data.

### Requirement 13: Performance of aggregate queries

**User Story:** As an Admin, I want the dashboard to load efficiently, so that metrics are available without slow or expensive queries.

#### Acceptance Criteria

1. THE Metrics_Service SHALL compute each grouped metric using a single COUNT/SUM/GROUP BY aggregate query rather than fetching individual rows into the application and counting them.
2. THE Metrics_Service SHALL bound every list query (recent invoices, webhook events, audit entries) with an explicit row limit.
3. WHEN multiple independent metric queries are required to render the Admin_Dashboard, THE Metrics_Service SHALL issue the independent queries concurrently.

### Requirement 14: Admin entry point and resilience

**User Story:** As an Admin, I want a reliable way into the dashboard, so that I can reach metrics and understand failures.

#### Acceptance Criteria

1. WHERE the current Parent is an Admin, THE system SHALL display a navigation link to the Admin_Dashboard.
2. WHERE the current Parent is not an Admin, THE system SHALL NOT display any navigation link to the Admin_Dashboard.
3. IF a metric query fails while rendering the Admin_Dashboard, THEN THE Admin_Dashboard SHALL display an error indicator for the affected metric section and SHALL continue to render the remaining sections.
