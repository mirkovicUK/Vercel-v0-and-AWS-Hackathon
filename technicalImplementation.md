# ApexMaths — Technical Implementation: Database Decision

> **Scope of this document:** why ApexMaths uses **Amazon Aurora PostgreSQL**,
> and how that choice is reflected in the data model, schema, and query design.
> This is the deliberate-architecture record for the database portion of the
> build.

---

## 1. Decision

**We use Amazon Aurora PostgreSQL** (accessed serverlessly through the **RDS Data
API**) as ApexMaths's system of record.

The choice was deliberate, and it was *not* our first instinct. Early on we
sketched the app as a key-addressed read model and leaned toward **DynamoDB** —
at the surface, much of the app is "load this parent and their children." But
when we looked at what the product's *core loop* and its *roadmap* actually ask
of a database — not how we fetch a profile, but how we **choose questions**,
**aggregate mastery**, and **report across learners** — the relational engine was
the clearly stronger fit. The deciding factors are query capability, data
integrity, and where the product is going (tutors and schools), not raw read
latency.

This document explains why, what we rejected, and how Aurora is integrated.

---

## 2. The product, in one line

Parents add up to three children; each child practises timed multiple-choice
maths papers drawn from a shared question bank; we track per-topic mastery over
time; access is gated by a Stripe subscription. The roadmap is an **adaptive**
tutor: choosing the *right* question for *this* child based on their history and
weak topics.

---

## 3. Why Aurora PostgreSQL — the substantive reasons

### 3.1 Choosing questions is a *query-capability* problem, not a storage problem

Every test type needs the same primitive:

> "Give me **N distinct random** questions matching a **topic** rule and a
> **difficulty range**."

In Postgres this is a single statement, and it is exactly what our code does
(`lib/db/questions.ts → pickQuestionIds`):

```sql
SELECT id FROM questions
WHERE active
  AND topic = :topic            -- omitted for mixed papers
  AND difficulty BETWEEN :lo AND :hi
ORDER BY random()
LIMIT :count;
```

The database performs filtered random sampling for us — always fresh, uniformly
random, against any combination of predicates, with no caching layer and no
staleness window. A key-value store cannot sample a *filtered* set natively; the
standard workaround is to load the candidate set into application memory and
shuffle in code. That is the tell we wanted to avoid: a database handing a
database job back to the application.

> **Honest scaling note (for expert reviewers):** `ORDER BY random()` sorts the
> matching rows, so it is O(matching rows). At our bank size (low thousands of
> static questions) that is trivial and ideal. If the bank ever grew large
> enough for that sort to matter, the work still stays *in the database* — e.g.
> a random-pivot read on an indexed random column
> (`WHERE r >= :anchor ORDER BY r LIMIT :n`, wrapping around), which reads ~N
> rows regardless of table size. (Plain `TABLESAMPLE` is not a drop-in here, as
> it samples pages before the `WHERE` filter is applied.) The architectural
> point is *where the sampling lives*: with Aurora it stays in the engine rather
> than moving into application memory.

### 3.2 The roadmap is adaptive selection — which is inherently relational

The next iteration of an 11+ tutor is *smarter* question selection:

- **don't repeat** questions a child saw in recent sessions → a join against
  their answer history,
- **weight toward weak topics** → a join against the child's per-topic mastery,
- **target the right difficulty** for that child → a predicate driven by their
  record.

In Aurora each of these is one query that joins the `questions` bank against the
child's `session_answers` and `progress`, ordered by a weighting expression. The
smarter the tutor gets, the **more** the database earns its place. On a key-value
store, each of those joins becomes "pull more data into memory and compute it in
application code" — the product getting more intelligent would mean the database
doing *less* and our functions doing *more*. We chose the engine that scales
**with** the product's intelligence rather than against it.

### 3.3 Platform growth: tutors and schools make the relational choice decisive

ApexMaths today is parent-and-child. The growth path is **tutors** (one tutor,
many students across many families) and **schools** (school → classes →
students). Those introduce genuinely relational, multi-entity, analytical
workloads:

- "How is **my class** doing — which topics is the cohort weakest on this term?"
- "Show every student a tutor manages, ranked by recent mock scores."
- cross-student and cross-cohort reporting, dashboards, and trend analysis.

These are joins and aggregations across many learners — precisely what a
relational engine is built for, and precisely what a single-table NoSQL design
makes painful (cross-entity analytics there tends toward full-table scans or a
secondary analytics pipeline). Choosing Aurora now means the schema and queries
that power a parent dashboard extend naturally into a tutor/school product
without re-platforming the data layer. We are deliberately provisioning for
where the product is heading.

### 3.4 Referential integrity is a feature we actively rely on

The data is a strict ownership tree (parent → child → session → answer), and our
schema enforces it with real foreign keys and cascade rules
(`scripts/sql/001_schema.sql`):

- a `session_answers` row **cannot** reference a question that does not exist
  (`question_id REFERENCES questions(id)`),
- deleting a parent cleanly removes their children, sessions, and answers
  (`ON DELETE CASCADE`) — which also gives us a correct, single-statement GDPR
  deletion path,
- uniqueness and domain rules are enforced *in the database*: one subscription
  per parent (`UNIQUE (parent_id)`), one answer per session slot
  (`UNIQUE (session_id, position)`), `difficulty BETWEEN 1 AND 5`,
  `year_group` bounds, and so on.

These guarantees live next to the data, not scattered through application code.
For a product that handles children's learning records and payments, that
integrity is a deliberate safety choice, not incidental.

### 3.5 Mastery tracking is a database aggregation

Per-topic mastery is a `GROUP BY` over a session's answers, computed and
persisted idempotently when a session completes (`lib/db/progress.ts`):

```sql
SELECT topic,
       count(*) FILTER (WHERE is_correct IS NOT NULL) AS attempts,
       count(*) FILTER (WHERE is_correct)             AS correct
FROM session_answers
WHERE session_id = :sessionId
GROUP BY topic;
```

The result is folded into the running `progress` row via `INSERT … ON CONFLICT
DO UPDATE`, recomputing the mastery percentage and classification in one
statement. Scoring at session completion is likewise a single
`count(*) FILTER (WHERE is_correct)`. The aggregation lives where the data lives.

---

## 4. How Aurora is integrated (data model, schema, query design)

This section maps directly to the judging question: *is the database integrated
thoughtfully, with a model/schema/query design that reflects a deliberate
choice?*

### 4.1 Schema (`scripts/sql/001_schema.sql`)

- **Typed domain via PostgreSQL `ENUM`s:** `topic`, `session_type`,
  `session_status`, `subscription_status`, `mastery_classification`. Illegal
  states are unrepresentable at the column level.
- **Normalised ownership tree** with foreign keys and `ON DELETE CASCADE`:
  `parents` → `subscriptions`, `children`, `sessions`; `sessions` →
  `session_answers`; `children` → `progress`.
- **Right tool *within* the tool — JSONB where the data is genuinely
  document-shaped:** question `options` and a session's ordered `question_ids`
  are stored as `JSONB`, because they are ordered value lists with no relational
  identity of their own. We use relational tables where relationships matter and
  JSONB where they do not — a considered hybrid, not dogmatic normalisation.
- **Purpose-built indexing, including partial indexes:**
  `idx_questions_topic … WHERE active` (only live questions are indexed for
  selection), `idx_children_parent … WHERE deleted_at IS NULL` (soft-deleted
  rows stay out of the hot index), plus per-parent/per-child/per-session
  indexes. The indexes are shaped to the queries, not sprayed across columns.
- **Operational integrity tables:** `processed_webhook_events` (Stripe
  idempotency), `audit_log` (append-only accountability), `revenue_events`.

### 4.2 Query design

- **Filtered random sampling** for question selection (§3.1).
- **`GROUP BY` aggregation with `FILTER`** for mastery and scoring (§3.5).
- **Idempotent writes:** answers are recorded with
  `UPDATE … WHERE answered_at IS NULL` so a resubmit cannot overwrite the first
  answer; progress upserts via `ON CONFLICT DO UPDATE`.
- **Transactions for multi-row consistency:** creating a session and pre-seeding
  its ordered answer slots happens inside one transaction
  (`withTransaction` in `lib/aws/rds-data.ts`), so a session and its slots are
  always consistent.

### 4.3 Serverless access — Aurora the *connectionless* way

ApexMaths runs on Vercel serverless functions. We deliberately reach Aurora
through the **RDS Data API** (`@aws-sdk/client-rds-data`,
`lib/aws/rds-data.ts`) rather than a traditional Postgres driver:

- it is an **HTTPS** API, so there is **no persistent connection pool** for
  ephemeral functions to exhaust — the classic "serverless + relational" pain
  point is removed by design,
- it needs **no VPC/NAT plumbing** from the function and never exposes the
  database publicly,
- authentication is **IAM** plus a **Secrets Manager** secret for the database
  credentials, so the raw password never touches application code or
  environment variables.

This is the considered answer to "but relational databases are awkward from
serverless": with the Data API on Aurora, they are not.

---

## 5. Why not the other two AWS options

### 5.1 Why not DynamoDB

DynamoDB is excellent when access is purely key-addressed and the scaling
requirement is extreme. Two things made it the weaker fit *for this product*:

1. **It cannot do filtered random sampling or history-aware joins in the
   database.** Our core loop (choosing questions) and our roadmap (adaptive,
   mastery-weighted selection) would have to run in application memory, with the
   question bank cached per function instance. The database would do less as the
   product grew smarter.
2. **No foreign keys.** The referential integrity we rely on (§3.4) would move
   entirely into application code.

It remains a strong engine — just optimised for a problem (massive-scale
key-value access) that is not the problem ApexMaths is solving.

### 5.2 Why not Aurora DSQL

Aurora DSQL's defining purpose is **multi-region, active-active writes at global
scale with minimal operational burden**. ApexMaths is a **single-region** UK
product with a single writer path; we would be adopting global-distribution
machinery we have no requirement for — exactly the "I just picked the impressive
one" choice the brief warns against. Additionally, DSQL's PostgreSQL surface is
deliberately constrained for its distributed design; our model leans on features
of conventional Aurora PostgreSQL (notably foreign-key enforcement and the RDS
Data API integration described above). DSQL is the right tool when you need
multi-region writes — we don't, so we didn't.

---

## 6. Trade-offs we acknowledge

- **`ORDER BY random()` is not free at very large scale.** Mitigated today by a
  small static bank, and Postgres keeps scalable sampling in-engine via an
  indexed random-pivot read if the bank grows (§3.1).
- **We are partly provisioning for the future** (tutors/schools). We accept that
  some relational power is latent today; the bet is deliberate, and it matches a
  concrete product roadmap rather than hypothetical scale.
- **Aurora has a higher operational floor than DynamoDB.** The RDS Data API
  removes connection-pool management from our serverless functions, which is the
  specific objection that would otherwise count against relational here.

---

## 7. One-line summary for reviewers

> We considered DynamoDB first, but ApexMaths is fundamentally about *choosing
> the right question for each learner* and *reporting across learners* — query
> and integrity problems, not key-value access problems. Aurora PostgreSQL does
> that work **in the database** today (filtered random selection, `GROUP BY`
> mastery, foreign-key integrity) and extends cleanly to our tutor/school
> roadmap, while the RDS Data API removes the usual serverless–relational
> friction. DSQL solves multi-region writes we don't need. Aurora is the
> deliberate fit.
