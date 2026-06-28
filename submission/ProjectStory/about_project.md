# ApexMaths — About the project

## The marking pile that started it

I have 3 kids, and I prepared both of them for the 11+ exam
for Grammar schools. I didn't do it with a tutor. Good 11+
tutoring runs into the thousands of pounds, and I couldn't justify that, so I did
it myself: printed papers, blue and red pen, and a lot of late evenings.

The teaching wasn't the hard part. **Marking and tracking was.**

Three things were the hardest, and all three are software problems hiding as
parenting problems:

1. **Silly mistakes destroy your data.** 11+ multiple-choice options are
   deliberately close. Sometimes my child would clearly understand a problem but tick
   the wrong box. As a parent you *know* they "really" got it — so do you give the
   mark or not? Either way, one judgement call at a time, your record of how
   they're doing quietly becomes fiction.
2. **You can't see the shape of the weakness.** Is she weaker at algebra or at
   geometry? Across twenty mixed papers, by hand, that's unanswerable. You end up
   guessing.
3. **You can't see movement.** "Is he actually improving since last month?" is, at
   best, an educated guess when your evidence is a stack of paper.

And the thing I wanted most was impossible on paper entirely: a practice session
that **adapts to what the child knows right now** — questions on the child's weakest topics, pitched at a difficulty that helps them build skills and make steady progress without hitting a wall.

I'm a software engineer. The whole time I kept thinking *there has to be a better
way to do this.* ApexMaths is that better way. Everything I learned doing it the
hard way is built into the product.

> The belief underneath it: **a child's chances should come down to their effort
> and potential — not whether their parents can afford a tutor.**

---

## What it does

A parent adds up to three children and picks a practice mode — a quick warm-up, a
single-topic drill, a full timed mock, or the adaptive **Skill Builder**. The
child answers; when they're stuck, an **AI tutor** streams a step-by-step method
without ever giving the answer away. At the end the score is instant, every wrong
answer gets an **AI explanation**, and the parent gets a dashboard — mastery over
time, accuracy by difficulty, strengths and gaps — topped with an **AI-written
summary in plain English**, because parents need answers, not more charts.

It's a real, monetizable product: Cognito accounts, Stripe subscriptions, an
operator/admin console, and UK GDPR compliance are all built and running — not
mocked.

---

## How I built it

**Vercel is the entire backend.** There's no separate API server. Every
privileged operation — auth, database, billing, AI — runs server-side in Next.js
Server Components, Server Actions, and Route Handlers on Vercel. The browser is a
thin client that never holds a secret and **never sees an answer key**: a question
is sent to the client with its `correctIndex` stripped out, grading is
server-authoritative and idempotent, and the timer is enforced on the server. You
can't cheat the UI because the UI doesn't know anything worth cheating.

**The data layer is the heart of it: Amazon Aurora Postgres (Serverless v2),
reached over the RDS Data API.** This was a deliberate choice, and it's the one
I'd defend hardest. My workload is relational to its core — choosing questions,
rolling answers into per-topic mastery, reporting across a child's whole history,
and erasing an account as a single cascading delete across **ten foreign keys**.
Those are joins, aggregates, and transactions, not a single partition key, so
**DynamoDB** was the wrong tool. And because I serve one UK-only market, I had no
need for **Aurora DSQL's** multi-region distributed writes. Aurora's storage is
already replicated across **three Availability Zones**, so the data survives an AZ
loss; I deliberately run a **single Serverless v2 instance** to keep costs near
zero for a pre-revenue product, with a Multi-AZ reader (one CDK line) as the
documented next step. The key advantage is the: **RDS Data API**: it lets a
serverless Vercel function reach a *private* Postgres database over HTTPS with **no
connection pool to exhaust, no VPC to enter, and no database password in my
code** — it kills the classic "serverless + relational" failure mode outright.

The schema does the work the engine is good at: window functions and `LAG()` for
mastery-over-time and improvement velocity, `FILTER` aggregates for
correct/wrong/skipped, a partial unique index that guarantees **one active session
per child** even under a concurrent double-submit, and foreign keys with three
different `ON DELETE` rules so GDPR erasure is one `DELETE FROM parents`.

**Security with no standing secrets.** Vercel reaches AWS through **OIDC
federation** — it presents a short-lived token that's exchanged for temporary IAM
credentials. There are **no static AWS keys anywhere**. The app holds only the
Secrets Manager *ARN*, never the password; and the role can only reach a dedicated
`app_user` database role with **DML-only** grants — never the schema owner. Least
privilege at both the AWS layer and the database layer.

**AI: one model, three jobs.** Everything — the streaming tutor hints, the
per-question review, and the parent report — runs on **Claude Sonnet 4.6 via
Amazon Bedrock**, resolved through a single accessor so the call sites can't
drift, and invoked through the **EU regional inference profile** co-located with
the functions in London. A strict **PII firewall** means prompts carry maths content and a year group only — never a name, email, or id.

**Identity & billing.** Cognito owns sign-up, verification, and JWTs (no client
secret); admin access is gated solely by a Cognito group claim and fails *closed*
(non-admins get a 404, so the admin area is invisible). Stripe runs Checkout and
the Customer Portal; the webhook is signature-verified and **idempotent**, with
subscription status driven only by subscription events and revenue only by paid
invoices.

All of it is defined in **AWS CDK**, and the correctness-critical logic is covered
by **property-based tests** with `fast-check`.

---

## The adaptive engine

The Skill Builder is a **pure, deterministic, I/O-free function** with an injected
seeded RNG, behind a thin data service — which is exactly why I could
property-test it instead of hoping it worked.

It concentrates practice where the child is weakest. For each attempted topic with
mastery $$m_t \in [0, 100]$$, the weight is inverse-mastery:

$$w_t = \big(\max(100 - m_t,\ \varepsilon)\big)^{\gamma}, \qquad \gamma = 1.5$$

Those weights are turned into whole-question counts per topic with the **Hamilton
largest-remainder method** plus a coverage floor, so every topic stays warm and
the counts sum *exactly* to the session length.

Difficulty targets the child's **zone of proximal development** — the band where
they're challenged but not crushed. Among the difficulty levels they've actually
attempted, with measured accuracy $$a_d$$, it picks

$$d^{\*} = \arg\min_{d}\,\bigl|\,a_d - 0.75\,\bigr|$$

aiming at ~75% accuracy, with a recency rule to avoid repeats and a fallback chain
that still fills the session if a weak topic is nearly exhausted. The same
relational analytics that *report* progress now *drive* what the child practises
next — so as the product gets smarter, the database does **more** work, not less.

And the "silly mistake" problem that broke my paper system? A topic isn't
classified until there are at least ten graded attempts, and mastery is a
cumulative ratio $$m_t = 100 \cdot c_t / n_t$$ — so one unlucky tick can't swing the
verdict the way it did with my red pen.

---

## Challenges I actually hit

- **The parent report wouldn't stream.** I wanted the report to render
  progressively, but the Bedrock provider buffers structured/tool output and
  emits it in one chunk at the very end — `streamObject` never actually streamed.
  The fix: **stream the report as raw JSON over `streamText` and parse the partial
  JSON on the client.** "Stream the text, parse the object." It now renders from
  ~1s instead of ~16s.
- **Latency where it's felt.** AI is slow relative to a tap. So I stream where the
  user is watching (hints, report) and **pre-compute off the critical path** where
  they're not: the post-session review runs inside Next.js `after()`, bounded by a
  timeout *and* an overall budget, degrading to deterministic text so it can never
  hang. The score shows instantly; explanations arrive behind it.
- **A sharp Data API edge.** The RDS Data API binds every parameter as a string,
  so a real `uuid` column compared against a bound string fails with
  `operator does not exist: uuid = text`. I made every id a `TEXT` column by
  design — small decision, saved a lot of pain.
- **Making "adaptive" trustworthy.** Personalisation is easy to get subtly wrong.
  Keeping the selection core pure let me assert real invariants as properties:
  allocation always sums to the target, no question repeats within a session, and
  it returns a full session whenever enough distinct questions exist.

---

## Accomplishments that we're proud of

- **I shipped it solo, and it's past MVP.** Real Cognito accounts, real Stripe
  subscriptions, an operator/admin console, and UK GDPR erasure — built and
  running, not stubbed.
- **A serverless frontend talking to a private relational database** with no
  connection pool, no VPC entry, and **no database password in the code** — the
  "serverless + relational" failure mode, designed out.
- **Zero standing AWS secrets.** OIDC federation for short-lived credentials, and
  a least-privilege `app_user` that can't even read the schema-owner secret.
- **An adaptive engine that isn't a black box** — a pure, deterministic core with
  invariants I can *prove* with property-based tests, not just hope for.
- **I beat the Bedrock streaming limitation** ("stream the text, parse the
  object") so the parent report renders from ~1s instead of ~16s.
- **An honest Well-Architected review** that names its own gaps instead of hiding
  them.
- And the one that actually matters to me: a parent can now get tutor-grade
  insight into their child's progress for the price of a couple of coffees a month.

---

## What I learned

- **Pick the database for the access patterns, not the hype.** Saying *why* Aurora
  — and why not DynamoDB or DSQL — taught me more than any feature did.
- **The RDS Data API is the unlock for serverless + relational.** No pool, no VPC,
  no password is genuinely freeing.
- **OIDC federation beats access keys** — once it clicked, putting a long-lived key
  in an environment variable started to feel archaic.
- **Property-based testing earns its keep** the moment logic gets non-trivial.
- And the product lesson: **data without interpretation doesn't help a tired
  parent** — the AI summary that reads the dashboard *for* you is the feature my
  past self actually needed.

I wrote an honest Well-Architected self-review (`submission/well-architected.md`)
that lists the gaps too — single-region, logs-only observability, no edge WAF yet
— because pretending there are none would be the least engineering thing I could do.

---

## What's next for ApexMaths

The hardest version — making it work brilliantly for **one** family — is done.
The next step is making it work for **many**.

- **Parent groups & community.** Let parents form a group — a school year cohort,
  a tutoring circle, or just a few friends — with opt-in shared progress, gentle
  friendly comparison, and group challenges and streaks to keep children
  motivated. Preparing for the 11+ is lonely; it shouldn't be. This is the move
  from "a tool for my kids" to "a place parents do this together."
- **More families, and schools.** Referrals for parents, and **school /
  classroom licences** — the admin contact inbox is already collecting that
  demand — taking ApexMaths from B2C into B2B2C.
- **More of the exam.** English comprehension and verbal / non-verbal reasoning
  papers alongside maths, reusing the same adaptive engine and analytics.
- **The scale work the review already names.** Read replicas for the analytics
  read path, partitioning the write-heavy answer log, and an indexed
  random-pivot question draw as the bank grows.
- **A deliberate database inflection point.** Today I'm UK-only, so I chose Aurora
  Postgres over Aurora DSQL. The day ApexMaths serves families across regions,
  that is *exactly* when DSQL's multi-region distributed writes would earn their
  place — a door I've deliberately left open.

*Built solo. For my kids first — and now for anyone else's.*
