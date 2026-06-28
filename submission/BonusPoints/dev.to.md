---
title: "6 things I learned shipping a full-stack app on Vercel + Amazon Aurora"
published: false
tags: aws, vercel, postgres, serverless
---

# 6 things I learned shipping a full-stack app on Vercel + Amazon Aurora

I built **ApexMaths** — an AI-powered UK 11+ maths tutor — for the **H0: Hack the Zero Stack with Vercel v0 and AWS Databases** hackathon. Frontend: Next.js on **Vercel**. Database: **Amazon Aurora PostgreSQL (Serverless v2)** over the **RDS Data API**. Here are the practical lessons, with the gotchas that cost me time.

> 📌 *Disclosure: I created this content for the purposes of entering the H0 hackathon.* **#H0Hackathon**

---

## 1. The RDS Data API kills the "serverless + relational" problem

The usual nightmare is connections — thousands of short-lived function invocations exhausting a Postgres connection pool, plus VPC plumbing to reach a private instance.

The **RDS Data API** is a stateless HTTPS endpoint, so there's nothing to pool. My Vercel functions call Aurora over HTTPS:

- no connection pool to exhaust,
- no VPC ingress (Aurora stays in private isolated subnets; my VPC runs zero NAT gateways),
- no database password in code — the app holds only a Secrets Manager **ARN**.

If you're putting a serverless frontend in front of a relational DB, start here.

## 2. The Data API binds every parameter as a string — so make your IDs `TEXT`

This one bit me. A real `uuid` column compared against a Data-API-bound string fails:

```
operator does not exist: uuid = text
```

The fix: I made **every `id` and `*_id` column `TEXT`**, storing the uuid value as text. No casting dance, no surprises.

```sql
CREATE TABLE children (
  id        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  ...
);
```

## 3. OIDC federation > static AWS keys

Vercel reaches AWS through **OIDC federation**: it presents a short-lived token, exchanged for temporary IAM credentials via STS. The role's trust policy accepts only my Vercel project, and permissions are least-privilege — `rds-data:*` scoped to one Aurora cluster.

**No long-lived AWS access keys** anywhere — not in code, env, or repo. Once you've set this up, putting an access key in an environment variable feels archaic.

## 4. Put invariants in the database, not just app code

I wanted "one active practice session per child," guaranteed even under a concurrent double-submit. Instead of app-level checks, I used a **partial unique index**:

```sql
CREATE UNIQUE INDEX uniq_active_session_per_child
  ON sessions(child_id) WHERE status = 'active';
```

A second concurrent `INSERT` with `status='active'` just fails at the DB level. Aurora enforces correctness for me.

## 5. Let the engine do analytics — no second data store

Mastery-over-time and accuracy breakdowns run *in Postgres* with window functions and `FILTER` aggregates — no ETL, no analytics warehouse:

```sql
SELECT child_id,
       completed_at,
       accuracy_pct
         - LAG(accuracy_pct) OVER (PARTITION BY child_id ORDER BY completed_at)
         AS improvement_vs_prev
FROM per_session;
```

This is exactly why I chose Aurora over DynamoDB: my access patterns are joins, aggregates, and transactions, not a single partition key. (And serving one UK market, I didn't need Aurora DSQL's multi-region writes.) The same relational data that *reports* progress also *drives* the adaptive engine that picks the next questions.

![Database schema](database-architecture.png)
*The relational model. (Upload `database-architecture.png` when posting.)*

## 6. Stream the text, parse the object

I wanted the AI parent report to render progressively. But the Bedrock provider buffers structured/tool output and emits it in one chunk at the end — so `streamObject` never actually streamed.

The fix: **stream the report as raw JSON over `streamText`, and parse the partial JSON on the client.** Sections now render from ~1s instead of ~16s. "Stream the text, parse the object."

(All AI — tutor hints, per-question review, parent summary — runs on Claude Sonnet 4.6 via Amazon Bedrock, with a PII firewall keeping names/emails out of prompts.)

---

## The stack, summarized

- **Vercel** — the entire backend (Server Components, Server Actions, Route Handlers); the browser is a thin client that never sees an answer key.
- **Amazon Aurora PostgreSQL (Serverless v2)** via the **RDS Data API** — the primary database, scaling to near-zero at idle.
- **Cognito** for identity, **Stripe** for billing, **Bedrock** for AI, all defined in **AWS CDK**.

I built it solo, and the correctness-critical logic is covered by property-based tests. The "Zero Stack" really does let a weekend-shaped frontend sit on an operationally serious database from day one.

---

*Built for **H0: Hack the Zero Stack with Vercel v0 and AWS Databases**. I created this content for the purposes of entering the H0 hackathon.* **#H0Hackathon**
