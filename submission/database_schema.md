# Database Architecture — Why I Chose Aurora

**App:** ApexMaths — a maths practice platform for parents and their children (Years 4–6).
**Database:** Amazon Aurora PostgreSQL (Serverless v2, engine 16.6), accessed via the RDS Data API.
**Frontend/host:** Next.js on Vercel (serverless functions + server actions).

---

## TL;DR

I chose **Aurora PostgreSQL Serverless v2** because my workload is relational at its core: it is dominated by multi-entity aggregations, ACID transactions, referential-integrity-driven deletes, and DB-enforced business invariants — none of which map cleanly to a single partition key. I did **not** need distributed multi-region writes (ruling out the primary reason to reach for Aurora DSQL) and I did **not** have a high-throughput key-value workload (ruling out DynamoDB). The deciding integration detail is that **Aurora Serverless v2 + the RDS Data API** lets a Vercel serverless frontend talk to a private Postgres database over HTTPS — with no VPC/NAT, no connection-pool exhaustion, and no database password in my code.

---

## My access patterns drove the choice

I started from how the app actually reads and writes data, then picked the engine that serves those patterns with the least friction. These are taken directly from my data layer (`lib/db/*`):

| Access pattern | What it requires | Engine fit |
|---|---|---|
| Roll a completed session into per-topic mastery (`applySessionToProgress`) | `GROUP BY topic`, `count(*) FILTER (WHERE is_correct)`, then an `ON CONFLICT … DO UPDATE` that recomputes a running percentage | Server-side aggregation + atomic upsert in one statement |
| Score and finalise a session (`completeSession`) | Aggregate correct answers, then a status transition guarded by `status = 'active'` | Multi-statement **ACID transaction** |
| Record a paid invoice + update the revenue rollup (`recordRevenueEvent`) | Idempotent insert (`ON CONFLICT (stripe_invoice_id) DO NOTHING`) plus distinct-paying-parent counting, in one commit | Cross-row consistency in a single transaction |
| "One active session per child" (`getActiveSession`, session creation) | Concurrency-safe uniqueness even under double-submit | **Partial unique index** (`WHERE status = 'active'`) — enforced by the DB, not racy app logic |
| GDPR account erasure (`hardDeleteParent`) | Delete one parent row → remove all owned data, keep shared/accounting data | **Foreign keys with differentiated `ON DELETE` rules** |
| Dashboard per-child progress across all 6 topics (`getChildProgress`) | Set-based read, indexed by `child_id` | Trivial indexed scan |
| Subscription entitlement from Stripe webhooks (`upsertSubscription`) | Upsert with out-of-order event protection | Conditional `WHERE` on conflict using a stored event timestamp |

The common thread: **relationships, aggregates, and invariants** — not "fetch item by key." That is the relational sweet spot.

---

## Why Aurora was the right call (not just that I used it)

**1. The data model uses the relational engine, deliberately.**
- **9 foreign keys with three different delete behaviours**, because erasure semantics differ per relationship:
  - `CASCADE` for owned data (`children`, `sessions`, `session_answers`, `progress`, `review_reports`, `subscriptions` → all cascade from `parents`).
  - `SET NULL` for `revenue_events.parent_id` — I keep the revenue row for accounting but de-attribute the person (GDPR).
  - `NO ACTION` for `session_answers.question_id` — deleting a user must never delete shared question-bank rows.
  
  This means my entire GDPR erasure path is a single `DELETE FROM parents` that the database resolves correctly and atomically. The delete policy lives in the schema, not in fragile application code.

- **Business invariants pushed into the database**: the `uniq_active_session_per_child` partial unique index guarantees a child can never have two active sessions, even under a concurrent double-submit — the second `INSERT` fails at Postgres.

- **Native types doing real work**: 5 `ENUM` types (topics, session/subscription status, mastery bands), `JSONB` for flexible payloads (`question_ids`, AI review `summary`), `NUMERIC(5,2)` for mastery scores, and `CHECK` constraints (`year_group BETWEEN 4 AND 6`, `difficulty BETWEEN 1 AND 5`). Domain rules are encoded in the model.

**2. The Vercel integration is what makes Aurora *work* here, not fight me.**
I deliberately use **Aurora Serverless v2 + the RDS Data API** (`enableDataApi: true` in my CDK):
- **No VPC / NAT Gateway** — Vercel functions reach the database over an AWS HTTPS service endpoint. My CDK runs `natGateways: 0`; Aurora stays in private isolated subnets and is never publicly exposed.
- **No connection-pool exhaustion** — the classic "serverless + Postgres" failure mode. The Data API is stateless HTTP, so thousands of short-lived function invocations don't exhaust TCP connections.
- **Scale-to-near-zero** — `serverlessV2MinCapacity: 0.5`, `MaxCapacity: 2`. I pay almost nothing at idle and scale up under load, which matches a new product with spiky, bursty traffic.
- **No secret in my code** — auth is the function's IAM credentials plus a Secrets Manager **ARN**; the actual DB password is fetched inside AWS and never touches the codebase, environment, or logs.

---

## Why not Aurora DSQL or DynamoDB

**Aurora DSQL — no, because I don't need distributed writes.**
DSQL's reason to exist is active-active, multi-region, horizontally-scalable distributed writes with strong consistency. ApexMaths is a single-region application with modest, bursty write volume. I also lean on Postgres features and semantics (extensions like `pgcrypto`, the specific enum/DDL behaviour, partial indexes used as invariants) that fit a standard Aurora PostgreSQL engine. Choosing DSQL would be solving a scaling/topology problem I do not have, at the cost of features I actively use.

**DynamoDB — no, because this is not a high-throughput key-value workload.**
My reads are aggregate- and relationship-heavy with **no single dominant partition key**. To serve "mastery grouped by topic," "distinct paying parents," "one active session per child," and cascade deletes in single-table DynamoDB, I would have to denormalize, fan out writes across many items, and re-implement aggregation and referential integrity in application code. That is more operational complexity to achieve less correctness. DynamoDB would be fighting the shape of my data.

**Plain RDS — close, but Serverless v2 + Data API is the better fit** for a Vercel-hosted serverless frontend: autoscaling to 0.5 ACU and HTTPS access without VPC plumbing or a connection pooler.

---

## Honest scaling note

The first component to need attention at very large scale is the write-heavy `session_answers` path (one row per question per session). The mitigations are standard relational ones — read replicas, then partitioning — and I would reach for those long before changing database paradigm. The relational model is correct for this domain; Serverless v2 gives me the runway.

---

## Schema at a glance

12 tables, 5 enums, 9 foreign keys, all id/FK columns `TEXT` (so the RDS Data API can bind every id as a string without `uuid = text` type errors):

`parents` · `subscriptions` · `children` · `questions` · `sessions` · `session_answers` · `progress` · `review_reports` · `audit_log` · `processed_webhook_events` · `revenue_events` · `revenue_summary`

Full DDL: `scripts/final_schema.sql`. The live schema has been cross-checked against this file (types, nullability, defaults, primary keys, unique constraints, foreign keys + delete rules, check constraints, indexes) — all match.
