# Serverless + relational, without the pain: connecting Vercel to Amazon Aurora over the RDS Data API

*I built this for the **H0: Hack the Zero Stack with Vercel v0 and AWS Databases** hackathon. This post explains how I wired a Next.js app on Vercel to a private Amazon Aurora PostgreSQL database — with no connection pool, no VPC ingress, and no static AWS keys anywhere.*

> 📌 *Disclosure: I created this content for the purposes of entering the H0 hackathon.* **#H0Hackathon**

---

## The project in one line

I built **ApexMaths**, a subscription product that helps UK families prepare children for the 11+ grammar-school maths exam: adaptive practice, an AI tutor, per-question AI review, and a parent analytics dashboard. The frontend is Next.js (scaffolded with Vercel v0) running on **Vercel**; the data layer is **Amazon Aurora PostgreSQL (Serverless v2)**, reached over the **RDS Data API**.

This article is about the part AWS database folks actually care about: *why Aurora, and how a serverless frontend talks to it cleanly.*

![ApexMaths runtime architecture](ApexMaths-Architecture.drawio.png)
*Runtime architecture — Vercel compute, OIDC federation into AWS, Aurora over the RDS Data API. (Upload `ApexMaths-Architecture.drawio.png` when posting.)*

---

## Why Aurora, and not DynamoDB or DSQL

I picked the database for my access patterns, not the hype. ApexMaths is relational to its core:

- **Choosing questions** by topic and difficulty, excluding recently-seen items.
- **Rolling answers into per-topic mastery** with aggregates over a child's history.
- **Analytics**: mastery-over-time uses window functions and `LAG()`; accuracy breakdowns use `FILTER` aggregates.
- **GDPR erasure**: deleting a parent cascades across ten foreign keys in one statement.

Those are joins, aggregates, and transactions — not a single partition key — so **DynamoDB** was the wrong fit. And because I serve one UK market, I had no need for **Aurora DSQL's** multi-region distributed writes. Aurora PostgreSQL is the natural home for this workload, and Serverless v2 scales to near-zero at idle, which suits a pre-revenue product with bursty (exam-season) traffic.

## The RDS Data API is the real unlock

The classic pain of "serverless + relational" is connections: thousands of short-lived function invocations exhausting a database connection pool, plus the VPC plumbing to reach a private instance.

The **RDS Data API** removes that entirely. It's a stateless HTTPS endpoint, so my Vercel functions call Aurora over HTTPS:

- **No connection pool** to exhaust — every call is an independent HTTP request.
- **No VPC to enter** — Aurora stays in private isolated subnets; I don't NAT or peer into the VPC. (My VPC even runs with zero NAT gateways.)
- **No database password in my code** — the app holds only the Secrets Manager *ARN*; the Data API resolves the credential inside AWS.

One sharp edge worth knowing: **the Data API binds every parameter as a string.** A real `uuid` column compared against a bound string fails with `operator does not exist: uuid = text`. I made every id a `TEXT` column by design — a small decision that saved a lot of pain.

## Zero static AWS keys: OIDC federation

Vercel reaches my AWS account through **OIDC federation**. Vercel presents a short-lived OpenID Connect token, which is exchanged for temporary IAM credentials via STS. The IAM role's trust policy accepts only my Vercel project's OIDC identity, and the role is least-privilege: `rds-data:*` scoped to exactly one Aurora cluster, plus read on one Secrets Manager secret and a specific Bedrock inference profile.

There are **no long-lived AWS access keys** in my code, environment, or repo. Least privilege is enforced twice: at the IAM layer, and again at the database — the role can only use a dedicated `app_user` Postgres role with DML-only grants, never the schema owner.

## The schema does the work

I pushed correctness into the engine rather than app code:

- **A business invariant as an index** — a *partial unique index* (`WHERE status = 'active'`) guarantees one active practice session per child, even under a concurrent double-submit.
- **Three `ON DELETE` strategies** — `CASCADE` for owned data (so GDPR erasure is one `DELETE FROM parents`), `SET NULL` to de-attribute financial/support rows while keeping them, and `NO ACTION` to protect the shared question bank.
- **Analytics live, in-engine** — no ETL, no second analytics store. The same relational data that *reports* a child's progress also *drives* what they practise next.

![Database schema](database-architecture.png)
*The relational model — tables, foreign-key relationships, and enums. (Upload `database-architecture.png` when posting.)*

## AI, one model, three jobs

Every AI surface — the streaming tutor hints, the per-question review, and the parent dashboard summary — runs on **Claude Sonnet 4.6 via Amazon Bedrock**, invoked through the EU regional inference profile co-located with my Vercel functions in London. A strict PII firewall means prompts carry maths content and a year group only — never a name, email, or id.

## What I'd tell another builder

- **Pick the database for the access patterns.** Being able to say *why Aurora, and why not DynamoDB or DSQL* in one sentence is worth more than any feature list.
- **The RDS Data API is the bridge** that makes serverless + relational genuinely pleasant: no pool, no VPC, no password.
- **OIDC federation beats access keys** — once it clicks, a long-lived key in an env var feels archaic.

Everything above is defined in AWS CDK, and the correctness-critical logic is covered by property-based tests.

That's the Zero Stack working as advertised: a weekend-shaped frontend on Vercel, sitting on an operationally serious AWS database from day one.

---

*Built for **H0: Hack the Zero Stack with Vercel v0 and AWS Databases**. I created this content for the purposes of entering the H0 hackathon.* **#H0Hackathon**
