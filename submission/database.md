# Database — Why ApexMaths Runs on Amazon Aurora PostgreSQL

**App:** ApexMaths — a UK 11+ maths practice platform for parents and their children (Years 4–6).
**Database:** Amazon **Aurora PostgreSQL Serverless v2** (engine 16.6), accessed via the **RDS Data API**.
**Host:** Next.js on **Vercel** (serverless functions + server actions). **Region:** `eu-west-2`.

---

## TL;DR

ApexMaths is a **relational workload at its core**: multi-entity aggregations, ACID
transactions, referential-integrity-driven deletes, and DB-enforced invariants —
none of which reduce to a single partition key. We chose **Aurora PostgreSQL
Serverless v2** because the database does the product's real work (choosing
questions, aggregating mastery, reporting across learners) *in the engine*. We
**didn't** need DynamoDB's high-throughput key-value access, and we **didn't** need
Aurora DSQL's multi-region distributed writes. The decisive integration detail:
**Serverless v2 + the RDS Data API** lets a Vercel serverless frontend reach a
private Postgres database over HTTPS — no VPC/NAT, no connection-pool exhaustion,
no DB password in our code.

It was a deliberate choice, not a default. Our first instinct was DynamoDB ("load
this parent and their children"), but the moment we looked at *how we choose
questions* and *how we report across learners*, the relational engine was clearly
the stronger fit.

---

## Access patterns drove the choice

Taken directly from our data layer (`lib/db/*`):

| Access pattern | What it requires | Why relational wins |
|---|---|---|
| Pick a session's questions (`pickQuestionIds`) | N distinct random rows filtered by topic + difficulty | **Filtered random sampling in the engine** — a NoSQL store would load candidates into app memory and shuffle |
| Roll a completed session into per-topic mastery (`applySessionToProgress`) | `GROUP BY topic` + `count(*) FILTER (WHERE is_correct)` then an upsert | Server-side aggregation + atomic `ON CONFLICT DO UPDATE` |
| Score + finalise a session (`completeSession`) | Aggregate correct answers, then a status transition guarded by `status='active'` | Multi-statement **ACID transaction** |
| One active session per child | Concurrency-safe uniqueness under double-submit | **Partial unique index** — enforced by Postgres, not racy app logic |
| GDPR account erasure (`hardDeleteParent`) | Delete one parent → remove all owned data, keep accounting rows | **FKs with differentiated `ON DELETE` rules** |
| Revenue rollup from `invoice.paid` (`recordRevenueEvent`) | Idempotent insert + distinct-paying-parent count, one commit | Cross-row consistency in a transaction |
| Subscription entitlement from webhooks (`upsertSubscription`) | Upsert with out-of-order event protection | Conditional `WHERE` on conflict using a stored event timestamp |

The common thread is **relationships, aggregates, and invariants** — not "fetch
item by key." Two examples make the point concrete:

```sql
-- Choosing questions: filtered random sampling, entirely in the engine.
SELECT id FROM questions
WHERE active AND topic = :topic::topic
ORDER BY random() LIMIT :count;

-- Mastery: a GROUP BY with FILTER, folded into a running row via upsert.
SELECT topic,
       count(*) FILTER (WHERE is_correct IS NOT NULL) AS attempts,
       count(*) FILTER (WHERE is_correct)             AS correct
FROM session_answers WHERE session_id = :sessionId GROUP BY topic;
```

The roadmap reinforces this. The next iteration — adaptive selection that avoids
recently-seen questions and weights toward weak topics — is a **join** of the
question bank against each child's `session_answers` and `progress`. The smarter
the tutor gets, the *more* the database earns its place; on a key-value store, the
product getting smarter would mean the database doing *less* and our code doing
more.

---

## The schema is the architecture (deliberate, not generated)

**12 tables · 5 enums · 9 foreign keys.** The design pushes correctness into the
engine rather than scattering it through application code:

- **Foreign keys with three different delete behaviours**, because erasure
  semantics differ per relationship:
  - `CASCADE` (7 FKs) for owned data — `children`, `sessions`, `session_answers`,
    `progress`, `review_reports`, `subscriptions` all cascade from `parents`.
  - `SET NULL` for `revenue_events.parent_id` — keep the revenue row for accounting,
    de-attribute the person (GDPR).
  - `NO ACTION` for `session_answers.question_id` — deleting a user must never
    delete shared question-bank rows.

  The entire GDPR erasure path is therefore a single `DELETE FROM parents` that the
  database resolves correctly and atomically.

- **A business invariant enforced as an index, not app logic:**

  ```sql
  CREATE UNIQUE INDEX uniq_active_session_per_child
    ON sessions(child_id) WHERE status = 'active';
  ```

  A child can never hold two active sessions — the second concurrent `INSERT` fails
  at Postgres, not in a racy read-then-write.

- **Native types doing real work:** 5 `ENUM`s (topics, session/subscription status,
  mastery bands) so illegal states are unrepresentable; `CHECK` constraints
  (`difficulty BETWEEN 1 AND 5`, `year_group BETWEEN 4 AND 6`); `NUMERIC(5,2)` for
  mastery scores.

- **A considered relational/document hybrid:** question `options` and a session's
  ordered `question_ids` are `JSONB` (ordered value lists with no relational
  identity); everything with relationships is a real table.

- **Indexes shaped to queries, including partial indexes:**
  `idx_questions_topic … WHERE active` (only live questions indexed for selection),
  `idx_children_parent … WHERE deleted_at IS NULL` (soft-deleted rows stay out of
  the hot index).

- **Operational-integrity tables:** `processed_webhook_events` (Stripe idempotency),
  `audit_log` (append-only), `revenue_events` / `revenue_summary`.

> All `id`/`*_id` columns are `TEXT` by design: the RDS Data API binds every
> parameter as a string, so a real `uuid` column compared to a bound string fails
> with `operator does not exist: uuid = text`. `parents.id` is the Cognito `sub`;
> other ids are `gen_random_uuid()::text`.

Full DDL: [`scripts/sql/001_schema.sql`](../scripts/sql/001_schema.sql).

---

## Serverless access — Aurora the connectionless way

This is what makes Aurora *work* from Vercel rather than fight it. We deliberately
use the **RDS Data API** (`@aws-sdk/client-rds-data`, `lib/aws/rds-data.ts`,
`enableDataApi: true` in CDK):

- **No connection pool to exhaust** — it's stateless HTTPS, so thousands of
  short-lived function invocations can't drown the database. This is the classic
  "serverless + relational" failure mode, removed by design.
- **No VPC / NAT** — `natGateways: 0`; Aurora sits in private isolated subnets and
  is never publicly exposed. Vercel reaches it over the AWS service endpoint.
- **No secret in our code** — auth is the function's **short-lived OIDC-federated
  IAM credentials** plus a Secrets Manager **ARN**; the DB password is resolved
  inside AWS and never touches the codebase, environment, or logs.
- **Scale-to-near-zero** — `serverlessV2MinCapacity: 0.5`, `MaxCapacity: 2`: near-nil
  at idle, scales under load — right for a new product with bursty traffic.

Our wrapper adds typed parameter binding (with `JSONB`/`timestamptz` type hints),
result coercion, and `BEGIN/COMMIT/ROLLBACK` transactions over the Data API.

---

## Why not the other two options

**DynamoDB — no.** Reads are aggregate- and relationship-heavy with no single
dominant partition key. Serving "mastery grouped by topic," "distinct paying
parents," "one active session per child," and cascade deletes would mean
denormalising, fanning writes across items, and re-implementing aggregation and
referential integrity in application code — more complexity for less correctness.

**Aurora DSQL — no.** Its reason to exist is active-active, multi-region distributed
writes. ApexMaths is single-region with a single writer path, and we lean on
conventional Aurora features DSQL constrains — foreign-key enforcement, `pgcrypto`,
the RDS Data API integration above. Picking DSQL would solve a topology problem we
don't have at the cost of features we actively use.

---

## Honest scaling note

`ORDER BY random()` sorts the matching rows — O(matching rows). At our bank size
(low thousands of static questions) that's ideal; if the bank grew large, the work
stays *in the engine* via an indexed random-pivot read
(`WHERE r >= :anchor ORDER BY r LIMIT :n`). The first table to need attention at
scale is the write-heavy `session_answers` path — addressed with standard
relational tools (read replicas, then partitioning) long before changing paradigm.
The relational model is correct for this domain; Serverless v2 gives us the runway.
