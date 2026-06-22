# ApexMaths — AWS Well-Architected Self-Review

**App:** ApexMaths — a UK 11+ maths practice platform for parents and their children (Years 4–6).
**Stack:** Next.js on **Vercel** (compute) · **Amazon Aurora PostgreSQL Serverless v2** via the **RDS Data API** · Amazon **Cognito** · Amazon **Bedrock** (Claude Sonnet 4.6) · AWS **Secrets Manager / IAM / VPC** · **Stripe**. **Region:** `eu-west-2` (London). **IaC:** AWS CDK (`infra/`).

This is a self-assessment of ApexMaths against the six pillars of the
[AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/):
operational excellence, security, reliability, performance efficiency, cost optimization,
and sustainability. For each pillar it states **what we do today** (grounded in the actual
codebase, not aspiration) and **what we'd do next at scale**. A final section lists the
**known high-risk items** candidly — the point of a Well-Architected review is to surface
them, not hide them.

> **Scope note.** Our compute runs on Vercel; our data, identity, and AI tiers run on AWS
> (Aurora, Cognito, Bedrock, Secrets Manager, IAM, VPC). We apply the Framework across the
> whole Vercel↔AWS topology, not just the AWS slice. See
> [`architecture_diagram.md`](./architecture_diagram.md) and [`database.md`](./database.md).

---

## 1. Operational Excellence

*Run and monitor the system; improve processes continually.*

**Today**
- **Infrastructure as code** — the entire AWS footprint (Cognito user pool + `admins` group, Aurora Serverless v2 with Data API, Secrets Manager, the OIDC IAM role, the NAT-free VPC) is defined in AWS CDK under `infra/`, so environments are reproducible and reviewable.
- **Idempotent, versioned migrations** — `scripts/sql/*.sql` applied by `scripts/migrate.mjs`; every statement is `IF NOT EXISTS`/guarded, so re-running is a safe no-op (`001` baseline, `002` adaptive, `003` contact).
- **An operator console** — `/admin` surfaces live business and operational health: revenue, subscriptions, engagement, content, **recent webhook events and the audit log**, plus at-risk learner cohorts and a contact inbox. Operators can see the system's state without touching the database.
- **Append-only audit log** — `audit_log` records auth, billing, AI usage, admin-access denials, contact submissions, and GDPR actions, written best-effort so logging never breaks a primary action.
- **Tested, spec-driven delivery** — Vitest + `fast-check` property tests for the correctness-critical pure logic (selection, grading, rate-limit, PII firewalls), and a written spec per feature in `.kiro/specs/`.

**Next at scale**
- CloudWatch dashboards + alarms (Aurora ACU, Data API errors, Bedrock latency/throttles), RDS Performance Insights, and an error tracker (e.g. Sentry) for the Vercel functions — today observability is structured logs only.
- A CI pipeline that runs typecheck + tests + build on every PR before deploy.

---

## 2. Security

*Protect data and systems; least privilege; detect and respond.*

**Today**
- **No long-lived AWS credentials anywhere.** Vercel assumes a least-privilege IAM role via **OIDC federation** (short-lived STS credentials). No access keys live in code, env, the template, or the repo.
- **No DB password in code or env.** The app holds only the Secrets Manager **ARN**; the password is resolved inside AWS by the RDS Data API.
- **Least privilege at two layers.** The app connects as a dedicated `app_user` Postgres role with **DML-only** grants (never the schema owner), and the IAM role is scoped to this cluster, this user pool, and the specific Bedrock model/inference-profile ARNs — it can read only the `app_user` secret.
- **Aurora is never publicly exposed** — private isolated subnets, **NAT-free** VPC (`natGateways: 0`); reached only over the AWS-managed Data API HTTPS endpoint.
- **Identity** — Amazon Cognito with no client secret (no-secret `USER_PASSWORD_AUTH`), httpOnly session cookies, ID-token verification against the pool JWKS on every request, and a **fail-closed admin guard** that answers non-admins with HTTP 404 (the admin area is invisible, not just forbidden).
- **Data-exposure firewalls by construction.** The practice **answer key (`correct_index`) is never serialised to the client** mid-session; the admin/at-risk/contact payload **types have no field** for `sub`, `stripe_customer_id`, or child PII, so forbidden data can't leak even by accident.
- **A hardened public write endpoint.** The contact form (the only unauthenticated write) is defended by bounded Zod validation, a honeypot, a DB-backed per-email/per-IP rate limit, **parameterized SQL only**, and React-escaped rendering of stored text.
- **GDPR by design** — `ON DELETE SET NULL` de-attribution on financial/support records, full erasure path, and an export path.

**Next at scale**
- AWS WAF (or an edge rate-limiter) in front of the public endpoints; automated Secrets Manager rotation; GuardDuty; a strict Content-Security-Policy; and a third-party security review.

---

## 3. Reliability

*Perform the intended function; recover from failure; meet demand.*

**Today**
- **Aurora Serverless v2 with Multi-AZ failover** within `eu-west-2` — the right durability level for a single-country product.
- **The RDS Data API removes the classic serverless failure mode** — it's stateless HTTPS, so a burst of short-lived Vercel function invocations can't exhaust a connection pool.
- **Idempotent, retry-safe billing** — Stripe webhooks are de-duplicated via a `processed_webhook_events` ledger, protected against out-of-order delivery (`status_event_at`), and the handler returns 500 (so Stripe retries) while marking an event processed **only after success**.
- **DB-enforced invariants** — a partial unique index guarantees one active session per child even under concurrent double-submit; session expiry is server-authoritative with zombie-session cleanup.
- **Graceful AI degradation** — the post-session review persists a deterministic skeleton **before** any AI call, runs the model off the critical path (`after()`), is bounded by an overall budget, never throws, and always finalises (fallback text if needed).
- **Per-section dashboard resilience** — admin metrics run under `Promise.allSettled`; one failing query degrades only its card, never the page.
- **Fail-closed, retryable GDPR erasure** — ordered so any failure leaves the account fully intact and retryable.

**Next at scale**
- Aurora read replicas for the analytics read path; documented backup/PITR restore drills; a written DR runbook; and a load test to validate ACU scaling under exam-season spikes.

---

## 4. Performance Efficiency

*Use resources efficiently; choose the right tools and sizes.*

**Today**
- **The database does the heavy lifting, in-engine.** Mastery trends use window functions and `LAG()`; cohorts and breakdowns use `FILTER`/`GROUP BY`; question selection samples in SQL — no row-by-row computation in app code.
- **Indexes shaped to the queries**, including partial indexes (`WHERE active`, `WHERE deleted_at IS NULL`) and the composite index behind the adaptive recency anti-join.
- **In-region inference** — Bedrock is invoked through the **EU regional inference profile** co-located with the Vercel functions in London, which roughly halved time-to-first-token versus the global profile in local measurement.
- **Latency hidden deliberately** — AI hints and the parent report **stream** token-by-token; the per-session review is pre-computed and polled so the score shows instantly.
- **Concurrency + targeted dynamism** — independent reads run concurrently (`Promise.allSettled`); `force-dynamic` is used only where per-request freshness matters; `revalidatePath` keeps cached views coherent after writes.

**Next at scale**
- A read-through cache for the largely-static question bank; partition the write-heavy `session_answers`; and switch `ORDER BY random()` question selection to an indexed random-pivot read once the bank grows large (mitigation already documented in `database.md`).

---

## 5. Cost Optimization

*Avoid unnecessary cost; pay for what you use.*

**Today**
- **Scale-to-near-zero data tier** — Aurora Serverless v2 at `0.5–2` ACU costs almost nothing at idle and scales under load, which suits a new product with bursty (exam-season) traffic.
- **NAT-free networking** — `natGateways: 0` removes the standing NAT Gateway cost and per-GB data-processing charges; the Data API endpoint replaces it.
- **Serverless compute + static marketing** — Vercel functions bill per use; the public marketing pages are prerendered static.
- **Bounded AI spend** — a single model resolved through one accessor, a hard cap of 5 hints per session, and the review batched off the critical path keep token usage predictable.
- **No payments infrastructure to run** — Stripe-hosted Checkout/Portal means no PCI scope or card-handling compute.

**Next at scale**
- Tune min/max ACU from Performance Insights data; AWS Budgets alarms; and a question-bank/explanation cache to cut repeat Bedrock calls.

---

## 6. Sustainability

*Minimize the environmental impact of running the workload.*

**Today**
- **High utilization, low idle** — scale-to-near-zero compute (Vercel functions) and database (Serverless v2) mean we don't burn energy on idle capacity.
- **Single region, matched to the audience** — the UK-only 11+ market is served from one nearby region (`eu-west-2`), avoiding needless cross-region replication and transatlantic traffic.
- **Efficient by query design** — pushing aggregation into indexed in-engine queries (rather than shipping rows to app code) and capping AI usage reduces compute cycles and inference energy per outcome.

**Next at scale**
- Continuously right-size ACU to actual demand, and prefer cached/deterministic paths over re-invoking the model where the result is equivalent.

---

## Known high-risk items (candid)

A Well-Architected review is judged on honesty about gaps, not a clean sheet. Ours:

1. **Single-region — no cross-region DR.** Multi-AZ covers an AZ failure, not a full-region outage. Acceptable for a UK-only v1; revisit if we expand.
2. **No edge WAF / edge rate-limiting yet.** The public contact endpoint is throttled at the DB layer only; a WAF is the right next control.
3. **Observability is logs-only.** No metric dashboards or alarms yet — a real gap for operating at scale.
4. **`source_ip` stored for the contact rate-limit** (documented, never displayed, de-attributed on erasure). A hash would reduce sensitivity further; deferred for v1.
5. **`ORDER BY random()` question selection** is ideal at the current bank size but not at very large scale (indexed-pivot mitigation documented).
6. **Cognito group-claim refresh latency** — a newly-granted admin gains access only after their ID token refreshes; inherent to JWT group claims, acceptable for v1.

---

*Prepared as a self-assessment of ApexMaths against the AWS Well-Architected Framework. It also
serves as the outline for a "how we built it" write-up; if published as a bonus contribution,
include a note that the content was created for the purposes of entering the H0 hackathon and
share with #H0Hackathon.*
