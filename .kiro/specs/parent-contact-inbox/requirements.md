# Requirements Document

## Introduction

Parent Contact Inbox adds a public **"Contact us"** channel to ApexMaths plus an operator-only **inbox** inside the existing `/admin` dashboard. A visitor (logged out or a signed-in Parent) reaches a public contact form from the marketing footer, submits `{ name, email, message }`, and a server action validates and persists the submission to a **new Aurora table `contact_messages`**. The defining design point is that the table is **relationally linked to the existing `parents` table**: when the submitter is a verified, signed-in Parent, the message captures that Parent's `id` (from the server-verified session) as `parent_id`; for logged-out visitors `parent_id` is null. This makes the inbox a relational surface, not a flat island table — the admin inbox query LEFT JOINs `contact_messages` → `parents` → `subscriptions` so operators triage each message with sender context (the linked Parent's email and subscription status), distinguishing an *active* subscriber from a *trialing* one from a logged-out visitor.

The public submission endpoint is **unauthenticated and write-capable**, so anti-abuse is a first-class requirement: bounded-length validation via the app's existing Zod conventions, a rate-limit throttle window (per-email and/or per-IP) plus a honeypot field, untrusted-text handling (safe escaping in the admin view, no injection/XSS), and parent linkage derived **only** from the verified server-side session (never a client-supplied id).

The admin inbox reuses already-shipped platform patterns: the `requireAdmin()` guard (fail-closed, HTTP 404), the RDS Data API query helpers (`lib/aws/rds-data.ts`), the existing append-only audit log (`lib/db/audit.ts`), and the existing `MetricSection` collapsible-card pattern in the admin dashboard. Outbound email/notifications, reply/outbound contact, and spam-scoring beyond the basic rate-limit + honeypot + validation remain explicitly out of scope.

### v2 amendment: a single one-way admin status transition

v2 introduces a single, one-way admin status transition (`new` → `seen`) so operators can track which messages they have handled. As a result the inbox is **no longer strictly read-only**: it now permits exactly this one mutation and no other. The `contact_messages.status` column already exists (`TEXT NOT NULL DEFAULT 'new'`), so **no database migration is required**; the only data-layer change is that the inbox query must now also select `status`. The acknowledgement is performed by an Admin-only server action (the Acknowledge_Action) that transitions a single message from `new` to `seen` and is idempotent. Reply, outbound email/notifications, archive, and delete remain out of scope.

### Deliberate, documented PII collection

The contact form **deliberately collects contact PII** — a submitter name, email address, and free-text message. Unlike the rest of the app (which minimises PII), this is a legitimate, consented support channel that the operator explicitly chose to offer. This collection is documented here with its erasure behavior: the `contact_messages.parent_id` foreign key uses `ON DELETE SET NULL` (matching the existing `revenue_events` GDPR pattern) so that when a Parent exercises erasure the message row is retained but de-attributed from the person. A retention consideration applies to the stored free-text contact data (see Requirement 10).

### Out of scope for v1

- Outbound email, auto-reply, or any notification triggered by a submission.
- Admin triage mutations other than the single one-way `new` → `seen` acknowledgement introduced in v2: reply, archive, delete, or any other change to `contact_messages.status`.
- Spam-scoring or reputation systems beyond the basic rate-limit window, honeypot, and input validation.

## Glossary

- **Contact_Message**: A row in the new `contact_messages` table representing one public contact submission.
- **Message_Status**: The value of the `contact_messages.status` column for a Contact_Message, one of `new` or `seen`, defaulting to `new`.
- **Acknowledge_Action**: The Admin-only server action that transitions a single Contact_Message from `new` to `seen` by updating its Message_Status.
- **Unread**: The state of a Contact_Message whose Message_Status is `new`.
- **Contact_Messages_Table**: The new Aurora PostgreSQL table `contact_messages` with columns: `id` TEXT PRIMARY KEY (`gen_random_uuid()::text`), `parent_id` TEXT NULL REFERENCES `parents(id)` ON DELETE SET NULL, `name` TEXT, `email` TEXT, `message` TEXT (length-bounded), `status` TEXT NOT NULL DEFAULT `'new'`, `created_at` TIMESTAMPTZ NOT NULL DEFAULT `now()`.
- **Contact_Form**: The public, server-rendered page hosting the contact submission form, reachable from the Marketing_Footer.
- **Marketing_Footer**: The existing footer component `components/marketing/marketing-footer.tsx`.
- **Submit_Action**: The server action that validates a contact submission, enforces anti-abuse controls, and persists a Contact_Message.
- **Visitor**: Any user of the Contact_Form, whether logged out or a signed-in Parent.
- **Parent**: An authenticated end user of ApexMaths, keyed by their Cognito `sub`, represented by a row in the `parents` table.
- **Session_Service**: The existing server module `lib/auth/session.ts` that verifies the Cognito session and returns the current Parent (`getCurrentParent`) or null when logged out.
- **Verified_Parent_Id**: The `parents.id` of the current Parent as returned by the Session_Service from the cryptographically verified session, or null when no verified session exists.
- **Contact_Schema**: The Zod schema validating `{ name, email, message }` and the Honeypot_Field, following the app's existing Zod conventions (e.g. `app/(app)/children/actions.ts`).
- **Name_Bounds**: The accepted length range for `name`: trimmed length between 1 and 80 characters inclusive.
- **Email_Bounds**: A syntactically valid email address whose length is between 3 and 254 characters inclusive.
- **Message_Bounds**: The accepted length range for `message`: trimmed length between 10 and 2000 characters inclusive.
- **Honeypot_Field**: A non-visible form field expected to remain empty for genuine submissions; a non-empty value indicates an automated/bot submission.
- **Rate_Limit_Window**: The rolling time window over which submissions from the same email address and/or source IP are counted for throttling. Default value: 5 submissions per email address and per source IP within a 60-minute rolling window.
- **Throttled_Submission**: A submission that exceeds the Rate_Limit_Window allowance and is therefore rejected without persisting a Contact_Message.
- **Admin**: An authenticated Parent whose verified Cognito ID token contains the value `admins` in its `cognito:groups` claim (as defined by the admin-dashboard spec).
- **Admin_Guard**: The existing server-side guard `requireAdmin()` in `lib/auth/guard.ts` that authorizes Admin-only surfaces, fails closed, and responds with HTTP status 404 on denial.
- **Admin_Dashboard**: The existing server-rendered page at `/admin` into which the inbox section is integrated.
- **Contact_Inbox**: The read-only admin section that lists recent Contact_Messages with sender context.
- **Inbox_Service**: The server-side module that retrieves Contact_Messages with sender context via the RDS Data API for the Contact_Inbox.
- **RDS_Data_Helpers**: The existing query helpers in `lib/aws/rds-data.ts` (`query`, `queryOne`) used for `SELECT`-only reads and parameterized writes.
- **MetricSection**: The existing collapsible card component in the admin dashboard used to render a titled admin section.
- **Audit_Log**: The existing append-only audit log written via `audit()` in `lib/db/audit.ts`.
- **Subscription_Status**: A value of the `subscription_status` enum: `trialing`, `active`, `past_due`, `canceled`, `incomplete`, `unpaid`.
- **Sender_Context**: For each Contact_Message, the linked Parent's email and Subscription_Status when `parent_id` is non-null; for a null `parent_id`, the message is shown as from a logged-out Visitor.
- **Inbox_Row_Limit**: An explicit maximum number of Contact_Messages returned by the inbox query, bounding query cost. Default value: 50.
- **PII**: Personally Identifiable Information.
- **Child_PII**: Any data that identifies or describes a child (a minor).

## Requirements

### Requirement 1: Provide a "Contact us" entry point in the marketing footer

**User Story:** As a Visitor, I want a "Contact us" link in the site footer, so that I can reach a contact form to message the operator.

#### Acceptance Criteria

1. THE Marketing_Footer SHALL display a "Contact us" link that navigates to the Contact_Form page.
2. WHEN a Visitor activates the "Contact us" link, THE system SHALL render the Contact_Form page.
3. THE Contact_Form SHALL present input fields for a name, an email address, and a message.
4. THE Contact_Form SHALL be reachable by a logged-out Visitor without requiring authentication.

### Requirement 2: Validate contact submissions with bounded inputs

**User Story:** As an operator, I want every contact submission validated with bounded inputs, so that stored messages are well-formed and the endpoint resists malformed or oversized payloads.

#### Acceptance Criteria

1. WHEN the Submit_Action receives a submission, THE Submit_Action SHALL validate the input using the Contact_Schema before any persistence occurs.
2. IF the submitted `name` has a trimmed length outside the Name_Bounds (1 to 80 characters inclusive), THEN THE Submit_Action SHALL reject the submission with a descriptive validation error and SHALL NOT persist a Contact_Message.
3. IF the submitted `email` is not a syntactically valid email address within the Email_Bounds (3 to 254 characters inclusive), THEN THE Submit_Action SHALL reject the submission with a descriptive validation error and SHALL NOT persist a Contact_Message.
4. IF the submitted `message` has a trimmed length outside the Message_Bounds (10 to 2000 characters inclusive), THEN THE Submit_Action SHALL reject the submission with a descriptive validation error and SHALL NOT persist a Contact_Message.
5. WHEN a submission satisfies every Contact_Schema constraint and every anti-abuse control, THE Submit_Action SHALL persist exactly one Contact_Message.
6. WHEN the Submit_Action persists a Contact_Message, THE Submit_Action SHALL set `status` to `'new'` and `created_at` to the persistence time.

### Requirement 3: Persist contact messages relationally linked to the parents table

**User Story:** As an operator, I want each message relationally linked to the submitter's parent account when they are signed in, so that the inbox can show sender context instead of an isolated message.

#### Acceptance Criteria

1. THE Contact_Messages_Table SHALL define `parent_id` as `TEXT NULL REFERENCES parents(id) ON DELETE SET NULL`.
2. WHEN a Contact_Message is persisted and the submission is made by a verified signed-in Parent, THE Submit_Action SHALL set `parent_id` to the Verified_Parent_Id.
3. WHEN a Contact_Message is persisted and the submission is made by a logged-out Visitor, THE Submit_Action SHALL set `parent_id` to null.
4. THE Submit_Action SHALL derive `parent_id` only from the Session_Service's verified session and SHALL NOT read any client-supplied parent identifier from the form, headers, query parameters, or cookies other than the verified session tokens.
5. WHEN a Parent referenced by a Contact_Message is deleted, THE Contact_Messages_Table SHALL set that message's `parent_id` to null and SHALL retain the message row, so the message is de-attributed rather than deleted (GDPR erasure pattern matching `revenue_events`).
6. THE Submit_Action SHALL persist the Contact_Message using a parameterized statement via the RDS_Data_Helpers.

### Requirement 4: Throttle public submissions to resist abuse

**User Story:** As a security owner, I want the public contact endpoint rate-limited, so that it cannot be trivially spammed.

#### Acceptance Criteria

1. WHEN the Submit_Action receives a submission, THE Submit_Action SHALL evaluate the submission against the Rate_Limit_Window before persisting a Contact_Message.
2. IF the number of prior submissions from the same email address within the Rate_Limit_Window has reached the allowance (default 5 per 60-minute rolling window), THEN THE Submit_Action SHALL reject the submission as a Throttled_Submission and SHALL NOT persist a Contact_Message.
3. IF the number of prior submissions from the same source IP within the Rate_Limit_Window has reached the allowance (default 5 per 60-minute rolling window), THEN THE Submit_Action SHALL reject the submission as a Throttled_Submission and SHALL NOT persist a Contact_Message.
4. WHEN the Submit_Action rejects a Throttled_Submission, THE Submit_Action SHALL return a message indicating that too many submissions have been made and that the Visitor should try again later.
5. THE Submit_Action SHALL enforce the Rate_Limit_Window using existing serverless-compatible storage (a database-backed count over recent Contact_Messages is acceptable) and SHALL NOT require new infrastructure.

### Requirement 5: Reject automated submissions via a honeypot

**User Story:** As a security owner, I want a honeypot field on the contact form, so that simple bots are rejected without burdening genuine Visitors.

#### Acceptance Criteria

1. THE Contact_Form SHALL include a Honeypot_Field that is not presented as a visible, labelled input to a genuine Visitor.
2. IF a submission arrives with a non-empty Honeypot_Field, THEN THE Submit_Action SHALL reject the submission and SHALL NOT persist a Contact_Message.
3. WHEN the Submit_Action rejects a submission due to a non-empty Honeypot_Field, THE Submit_Action SHALL respond as a successful submission to the Visitor and SHALL NOT reveal that the honeypot triggered the rejection.

### Requirement 6: Record a submission event in the audit log

**User Story:** As a security owner, I want each accepted contact submission recorded in the audit log, so that the support channel has the same accountability as other privacy-relevant actions.

#### Acceptance Criteria

1. WHEN the Submit_Action persists a Contact_Message, THE Submit_Action SHALL record an entry in the Audit_Log describing a contact-submission event.
2. WHEN the Submit_Action records the contact-submission Audit_Log entry for a signed-in Parent, THE Submit_Action SHALL set the entry's `parent_id` to the Verified_Parent_Id.
3. THE Submit_Action SHALL NOT include any PII beyond what the Audit_Log is already permitted to store in the contact-submission entry detail.
4. IF writing the Audit_Log entry fails, THEN THE Submit_Action SHALL still complete the persistence of the Contact_Message and SHALL NOT surface the audit failure to the Visitor.

### Requirement 7: Authorize the contact inbox through the existing admin guard

**User Story:** As a security owner, I want the inbox gated by the same admin authorization as the rest of `/admin`, so that no new access path is introduced and unauthorized users cannot reach the messages.

#### Acceptance Criteria

1. WHEN any page that renders the Contact_Inbox is requested, THE Admin_Dashboard SHALL invoke the Admin_Guard and obtain an authorization decision before computing, fetching, or rendering any Contact_Message data.
2. WHEN any data fetch that returns Contact_Inbox data is invoked, THE Inbox_Service SHALL execute its retrieval only after the Admin_Guard has returned an authorized decision for that same request.
3. IF the Admin_Guard denies access, THEN THE system SHALL return HTTP status 404 and SHALL NOT fetch or return any Contact_Message data or any indication that such data exists.
4. THE Inbox_Service SHALL NOT introduce, expose, or honor any authorization mechanism other than the existing Admin_Guard.
5. WHEN the Contact_Inbox is requested, THE Admin_Dashboard SHALL render it dynamically per request and SHALL NOT serve statically cached Contact_Message values.

### Requirement 8: Display recent messages with linked sender context

**User Story:** As an Admin, I want to see recent contact messages joined to the sender's account and subscription status, so that I can triage with context.

#### Acceptance Criteria

1. WHEN an authorized Admin loads the Contact_Inbox, THE Inbox_Service SHALL retrieve the most recent Contact_Messages ordered by `created_at` descending, bounded by the Inbox_Row_Limit (default 50).
2. THE Inbox_Service SHALL retrieve Sender_Context using a single query that LEFT JOINs `contact_messages` to `parents` and to `subscriptions` on `parent_id`.
3. WHEN the Contact_Inbox renders a Contact_Message, THE Admin_Dashboard SHALL display the submitter `name`, `email`, `message`, and `created_at`.
4. WHERE a Contact_Message has a non-null `parent_id`, THE Admin_Dashboard SHALL display the linked Parent's email and the linked Parent's Subscription_Status as Sender_Context.
5. WHERE a Contact_Message has a null `parent_id`, THE Admin_Dashboard SHALL display the message as from a logged-out Visitor and SHALL NOT invent a linked Parent identity.
6. WHERE a Contact_Message has a non-null `parent_id` but the linked Parent has no subscription row, THE Admin_Dashboard SHALL display the Subscription_Status as none rather than an invented status.
7. IF no Contact_Messages exist, THEN THE Admin_Dashboard SHALL display an empty-state message indicating that no contact messages have been received.
8. THE Contact_Inbox SHALL be presented as a titled section using the existing MetricSection collapsible-card pattern.

### Requirement 9: Render stored free-text safely

**User Story:** As a security owner, I want stored message text treated as untrusted, so that the admin view cannot be used to inject scripts or markup.

#### Acceptance Criteria

1. WHEN the Contact_Inbox renders a Contact_Message `name`, `email`, or `message`, THE Admin_Dashboard SHALL render the stored value as escaped text and SHALL NOT interpret it as executable script or active markup.
2. THE Contact_Inbox SHALL treat every stored Contact_Message field as untrusted data regardless of how it was submitted.

### Requirement 10: Privacy and PII discipline for the contact surface

**User Story:** As a data-protection owner, I want the contact channel's PII handling documented and bounded, so that it collects only what the support channel needs and exposes nothing further in the admin view.

#### Acceptance Criteria

1. THE Contact_Form SHALL collect only the submitter `name`, `email`, and `message` as Visitor-provided PII.
2. WHEN the Contact_Inbox renders a Contact_Message, THE Admin_Dashboard SHALL limit displayed sender data to the submitter `name`, `email`, `message`, the linked Parent's email, and the linked Parent's Subscription_Status.
3. THE Contact_Inbox SHALL NOT display a linked Parent's Cognito `sub` or `stripe_customer_id`.
4. THE Contact_Inbox SHALL NOT display any Child_PII.
5. WHEN a Parent is deleted, THE Contact_Messages_Table SHALL de-attribute that Parent's messages by setting `parent_id` to null while retaining the stored free-text, consistent with the documented erasure behavior.

### Requirement 11: Message status lifecycle and acknowledgement

**User Story:** As an Admin, I want to acknowledge a contact message so its status moves from `new` to `seen`, so that I can track which messages I have already handled.

#### Acceptance Criteria

1. WHEN the Inbox_Service retrieves Contact_Messages for the Contact_Inbox, THE Inbox_Service SHALL also select the `status` column AND the returned payload SHALL carry the Message_Status for each Contact_Message.
2. WHEN the Acknowledge_Action is invoked for a Contact_Message whose Message_Status is `new`, THE Acknowledge_Action SHALL transition that Contact_Message to `seen` via a single parameterized `UPDATE` of `contact_messages.status` for the given message id using the RDS_Data_Helpers.
3. THE Acknowledge_Action SHALL treat the transition as one-way and SHALL NOT change a Contact_Message whose Message_Status is `seen` back to `new`.
4. WHEN the Acknowledge_Action is invoked for a Contact_Message whose Message_Status is already `seen`, THE Acknowledge_Action SHALL complete as a no-op that leaves the Message_Status as `seen` and SHALL NOT return an error (idempotent).
5. WHEN the Acknowledge_Action is invoked, THE Acknowledge_Action SHALL invoke the Admin_Guard independently and obtain an authorized decision before reading or mutating any Contact_Message, because the Acknowledge_Action is an independently-invocable server action and is not protected merely by any page-level guard.
6. IF the Admin_Guard denies access to the Acknowledge_Action, THEN THE system SHALL return HTTP status 404 AND THE Acknowledge_Action SHALL NOT mutate any `contact_messages` row.
7. WHEN the Acknowledge_Action receives a supplied message id, THE Acknowledge_Action SHALL validate and parse that message id before issuing the `UPDATE`, AND IF the supplied message id is missing or invalid, THEN THE Acknowledge_Action SHALL reject the request with a validation error and SHALL NOT mutate any `contact_messages` row.
8. WHEN the Acknowledge_Action transitions a Contact_Message to `seen`, THE Acknowledge_Action SHALL record an Audit_Log entry for the acknowledgement (action `contact.acknowledged`) on a best-effort basis.
9. IF writing the acknowledgement Audit_Log entry fails, THEN THE Acknowledge_Action SHALL retain the `new` → `seen` status change and SHALL NOT undo the status change.
10. THE Contact_Inbox SHALL NOT provide any reply, archive, delete, or outbound-message control AND the only permitted mutation of `contact_messages` from the Contact_Inbox SHALL be the `new` → `seen` transition performed by the Acknowledge_Action.

### Requirement 12: Expandable inbox presentation and acknowledgement controls

**User Story:** As an Admin, I want each message to be individually expandable with a clear unread indicator and an acknowledge control, so that I can scan, read, and mark messages as seen efficiently.

#### Acceptance Criteria

1. THE Contact_Inbox SHALL render each Contact_Message as an individually expandable and collapsible item.
2. WHILE a Contact_Message item is collapsed, THE Contact_Inbox SHALL display a compact summary comprising the submitter `name`, the `created_at` date, the submitter `email`, and the Sender_Context line.
3. WHILE a Contact_Message item is expanded, THE Contact_Inbox SHALL reveal the full `message` text.
4. WHILE a Contact_Message item is expanded AND the Contact_Message is Unread, THE Contact_Inbox SHALL present an acknowledge control that invokes the Acknowledge_Action for that Contact_Message.
5. THE Contact_Inbox SHALL visually distinguish Unread Contact_Messages from `seen` Contact_Messages using distinct styling.
6. WHEN an Admin acknowledges a Contact_Message, THE Contact_Inbox SHALL reflect the resulting `seen` state without a manual page reload (for example via revalidation).
7. WHEN a Contact_Message has Message_Status `seen`, THE Contact_Inbox SHALL NOT offer the acknowledge control for that Contact_Message.
