# ApexMaths — AI-powered 11+ maths practice

**Making high-quality 11+ maths preparation accessible to every family.**

ApexMaths is a full-stack subscription product that helps UK children (school
Years 4–6) prepare for the **11+ grammar-school entrance exam** — with adaptive
practice, an AI tutor, per-question AI review, and a parent analytics dashboard
that explains itself in plain English.

| | |
|---|---|
| **Track** | B2C, monetizable (£19.99/mo, 7-day trial, up to 3 children) |
| **Frontend / host** | Next.js 16 (App Router, v0-scaffolded) on **Vercel** — London `lhr1` |
| **Primary database** | **Amazon Aurora Postgres** (Serverless v2) via the **RDS Data API** |
| **Other AWS** | Cognito (identity) · Bedrock — Claude Sonnet 4.6 (AI) · Secrets Manager · IAM · VPC |
| **Payments** | Stripe (Checkout, Customer Portal, webhooks) |
| **IaC** | AWS CDK (`infra/`) · **Region** `eu-west-2` |
| **Live demo** | https://vercel-v0-and-aws-hackathon.vercel.app/ |

Deep-dive docs: [Architecture](submission/architecture_diagram.md) ·
[Database rationale](submission/database.md) ·
[Vercel as the compute tier](submission/vercel.md) ·
[Well-Architected self-review](submission/well-architected.md)

---

## 🔑 Try it live (free — no real payment)

**Live app:** https://vercel-v0-and-aws-hackathon.vercel.app/

Billing runs on a **Stripe sandbox (test mode)**, so you can subscribe and use the
full product **without any real charge**. To explore everything:

1. **Sign up** with an email and confirm the verification code Cognito emails you.
2. Complete the short **onboarding** (guardian / age attestation).
3. **Subscribe** with Stripe's test card:

   | Field | Value |
   |---|---|
   | Card number | `4242 4242 4242 4242` |
   | Expiry | any **future** date (e.g. `12/34`) |
   | CVC | any 3 digits (e.g. `123`) |
   | Name / postcode | anything (e.g. `AB12 3CD`) |

4. Add a child, run a **Skill Builder** session, tap **"Show me how"**, finish to
   see the **AI review**, then open the child's **analytics dashboard**.

> The `4242…` card always succeeds in test mode — no real money moves. (Admin
> dashboard access is restricted to operators in the Cognito `admins` group.)

---

## Real-world impact — the problem and who it's for

In England, a place at a state grammar school comes down to a single exam, the
11+. Places are scarce and competition is intense, so good preparation has
historically meant **private tutoring that costs families thousands of pounds**.
That puts the best preparation out of reach for many — a child's outcome ends up
correlating with a parent's budget.

ApexMaths uses AI to deliver the things parents pay tutors for — practice tuned
to the child, step-by-step help when they're stuck, and an honest read on
progress — at a price an ordinary family can afford. **A child's chances should
come down to their effort and potential.**

This is a **monetizable B2C product**, not a tech demo: real authentication,
real subscriptions and billing, an operator console, and GDPR compliance are all
implemented and running.

---

## What we offer

- **Four practice modes** — Warm-up (10q), Practice-a-topic (5q), Full mock
  (30q, timed), and the adaptive **Skill Builder** (15q tuned to the child).
- **AI tutor ("Show me how")** — streams a step-by-step method when a child is
  stuck, and never reveals the answer; ask again and it explains a *different*
  way.
- **Per-question AI review** after every test, with a plain-language explanation
  of each mistake and a concrete next step.
- **Parent analytics** — mastery over time, accuracy by difficulty, strengths
  and focus areas, plus an **AI-written narrative summary** so a busy parent
  isn't left to interpret charts.
- **Up to 3 child profiles**, each with independent progress.
- **Operator/admin console** — revenue, subscriptions, engagement, at-risk
  learners, and a contact inbox.

---

## Design — full-stack thinking, not a pretty shell

The front-end is deliberately a **thin client**: it never holds a secret, never
sees an answer key, and never talks to a database. Every privileged operation
runs server-side on Vercel (Server Components, Server Actions, Route Handlers).

- **The answer firewall.** A question is projected to the client *without* its
  `correctIndex`. Grading is **server-authoritative and idempotent** (first
  answer wins), and the session timer is enforced on the server — the UI can't
  be gamed.
- **Latency hidden two ways.** AI hints and the parent report **stream**
  token-by-token so they feel instant; the post-session review is **pre-computed
  off the critical path** so the score appears immediately and explanations fill
  in as they're ready.
- **Charts ship rendered, not raw.** The analytics dashboard runs its queries on
  the server and sends only the rendered charts — the analytical SQL never
  reaches the browser.
- **Coherent UI** — Tailwind v4 + Radix primitives, accessible components, and
  `revalidatePath` so views stay consistent immediately after a write.

More: [`submission/vercel.md`](submission/vercel.md).

---

## Technical implementation — the engineering

A single security boundary, least privilege everywhere, and the database doing
the real work.

**Identity — Amazon Cognito.** Branded forms over the no-secret
`USER_PASSWORD_AUTH` flow (no Cognito client secret to leak). Sessions are
httpOnly cookies; the ID token is verified against the pool JWKS on every request
and **transparently refreshed**. Authorization is layered and enforced *before* a
page renders:

```
requireParent          → signed in?              (else /sign-in)
requireOnboardedParent → guardian/age attested?  (else /onboarding)
requireEntitledParent  → live Stripe entitlement? (else /billing, audited)
```

Admin access is gated solely by the Cognito **`admins` group** claim, and the
guard is **fail-closed** — non-admins get a 404, so the admin area is invisible,
not merely forbidden.

**Payments — Stripe (this is a real, monetizable product).** Stripe-hosted
Checkout and Customer Portal mean no card data touches our compute. Trial
eligibility is computed at checkout so a user can't farm repeat free trials. The
webhook is **signature-verified and idempotent** (a `processed_webhook_events`
ledger), returns 500 so Stripe retries on failure, and marks an event processed
only after success. Crucially, **subscription status changes come only from
`customer.subscription.*` events and revenue only from `invoice.paid`** — the
two never cross.

**AI — Amazon Bedrock, Claude Sonnet 4.6, one model accessor.** Every AI
surface resolves through a single `appModel()`, so the three call sites can't
drift. Invoked through the **EU regional inference profile**, co-located with the
Vercel functions in London (roughly halved time-to-first-token vs. the global
profile). Three deliberately different execution shapes:

- *Streaming hints* — `streamText` straight to the browser.
- *Parent report* — **streamed as raw JSON and parsed progressively on the
  client.** The Bedrock provider buffers structured/tool output and emits it in
  one chunk at the end, so `streamObject` never actually streams; streaming raw
  JSON over `streamText` and parsing the partial object client-side renders the
  report's sections from ~1s. (**"stream the text, parse the object."**)
- *Post-session review* — non-streaming `generateText` run inside Next.js
  `after()` (off the response path), bounded by a per-call timeout **and** an
  overall budget, and degrading to deterministic fallback text so it can never
  hang.

A **PII firewall** runs through all of it: AI prompts get maths content and year
group only — never names, emails, or IDs.

**Database — Amazon Aurora Postgres + the RDS Data API.** The product's real
work is relational, and the schema pushes correctness into the engine:

- **13 tables, 5 enums, 10 foreign keys** with three different `ON DELETE`
  behaviours — `CASCADE` for owned data (GDPR erasure is one `DELETE FROM
  parents`), `SET NULL` to de-attribute accounting/support rows while keeping
  them, `NO ACTION` to protect the shared question bank.
- A **business invariant as an index**: a partial unique index guarantees one
  active session per child even under a concurrent double-submit.
- **Analytics live, in-engine** — window functions and `LAG()` for mastery
  trends, `JOIN` + `FILTER` aggregates for accuracy breakdowns — no ETL, no
  second analytics store. A denormalised `progress` rollup serves the instant
  snapshot; the same event log powers the rich history on demand.

**Vercel ↔ AWS with no static keys.** Vercel assumes a least-privilege IAM role
via **OIDC federation** (short-lived STS credentials). The app holds only the
Secrets Manager **ARN**, never the password; the DB role it uses is a dedicated
**`app_user` with DML-only grants** (never the schema owner). Aurora sits in
private isolated subnets in a **NAT-free VPC**, reached only over the Data API's
HTTPS endpoint — no connection pool to exhaust, no public exposure.

**Why Aurora (the choice was deliberate).** Choosing questions, rolling answers
into per-topic mastery, cascade-delete erasure, and live window-function
analytics are joins, aggregates, and transactions — not a single partition key,
so DynamoDB was the wrong fit. Serving one UK market, we didn't need Aurora
DSQL's multi-region distributed writes. Aurora replicates storage across three
Availability Zones automatically, so data is durable to an AZ loss; we
deliberately run a single Serverless v2 compute instance to keep cost near zero
for a pre-revenue product, with a second-AZ reader for sub-minute automatic
failover as a one-line next step. Full reasoning, with the access-pattern table
and the "three tables deliberately have no foreign keys" discussion, is in
[`submission/database.md`](submission/database.md).

**Tested where it matters.** The correctness-critical pure logic (adaptive
selection, grading, rate-limiting, the PII projections) is covered by **Vitest +
`fast-check` property tests**.

---

## Originality — the idea isn't new, the approach is

Families have prepared for the 11+ for decades. What's new here:

- **The adaptive Skill Builder is a pure, property-tested core.** All the
  decision logic — inverse-mastery weighting (more practice on weak topics),
  Hamilton allocation with a coverage floor, **ZPD difficulty targeting** (aim
  where the child scores ~75%), a 1-day recency exclusion, and cold-start
  handling — lives in a **deterministic, I/O-free function** behind a thin
  server-only data service. The same relational analytics that *report* progress
  now *drive* what the child practises next. (`lib/practice/adaptive-selection.ts`)
- **Analytics that explain themselves.** A dashboard can overwhelm a busy parent,
  so AI reads the whole picture and writes a plain-English summary of how the
  child is really doing and what to do next — turning data into guidance.
- **A tutor that re-teaches, not just repeats.** Ask for help twice and the model
  is steered to a genuinely different, still-correct method.
- **The product getting smarter makes the database do *more*, not less** — the
  opposite of what a key-value store would push you toward.

---

## Status — beyond MVP

This is past a weekend prototype. Implemented and running today: Cognito auth +
onboarding, Stripe subscriptions/billing with an idempotent webhook, four
practice modes incl. the adaptive engine, the AI tutor / review / parent report,
the parent analytics dashboard, an operator/admin console (metrics, at-risk
cohorts, contact inbox), GDPR export + erasure, full AWS CDK infrastructure, and
property-tested core logic. Candid gaps and next-at-scale steps are listed
honestly in [`submission/well-architected.md`](submission/well-architected.md).

---

## Write-ups & articles

I wrote up how ApexMaths was built on the Vercel + AWS "Zero Stack" — three
published pieces, each a different angle (**#H0Hackathon**):

- **AWS Builder Center** — *Serverless + relational, without the pain: connecting
  Vercel to Amazon Aurora over the RDS Data API* —
  https://builder.aws.com/content/39q76RB0I0jB8AaTgqziSfYk5lo/serverless-relational-without-the-pain-connecting-vercel-to-amazon-aurora-over-the-rds-data-api
- **Medium** — *I built an AI 11+ maths tutor solo on the "Zero Stack" — Vercel +
  AWS Aurora* —
  https://medium.com/@uros1311/i-built-an-ai-11-maths-tutor-solo-on-the-zero-stack-vercel-aws-aurora-65f00c096cc5
- **dev.to** — *6 things I learned shipping a full-stack app on Vercel + Amazon
  Aurora* —
  https://dev.to/aurora75/6-things-i-learned-shipping-a-full-stack-app-on-vercel-amazon-aurora-3im4

Source copies live in [`submission/BonusPoints/`](submission/BonusPoints/).

---

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # Vitest + fast-check
```

Requires AWS (Aurora + Data API, Cognito, Bedrock), Stripe, and the matching env
vars — provision with the CDK stack in [`infra/`](infra/) and apply the schema
with `node scripts/migrate.mjs`. Connection details come from the environment;
no secrets or ARNs are committed to the repo.

> Built with [v0](https://v0.app) and deployed on Vercel; data, identity, and AI
> run on AWS. See [`submission/`](submission/) for the full architecture,
> database, and Well-Architected write-ups.
