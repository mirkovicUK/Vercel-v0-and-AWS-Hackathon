# I built an AI 11+ maths tutor solo on the "Zero Stack" — Vercel + AWS Aurora

*How I shipped a real, monetizable product — adaptive practice, an AI tutor, and a parent dashboard — for the **H0: Hack the Zero Stack with Vercel v0 and AWS Databases** hackathon.*

> 📌 *Disclosure: I created this content for the purposes of entering the H0 hackathon.* **#H0Hackathon**

---

## The problem I actually lived

I prepared my own children for the UK 11+ grammar-school exam without a tutor — good 11+ tutoring runs into the thousands. The teaching wasn't the hard part. **Marking and tracking was.** Silly mistakes corrupted my sense of how they were really doing, I couldn't see whether algebra or geometry was the weak spot across twenty mixed papers, and "are they actually improving?" was a guess.

I'm a software engineer, so I kept thinking *there has to be a better way.* **ApexMaths** is that better way: AI delivers the things parents pay tutors for — practice tuned to the child, step-by-step help when they're stuck, and an honest read on progress — at a price an ordinary family can afford.

This is the build story.

## What it does

A parent adds up to three children and picks a mode — a quick warm-up, a single-topic drill, a full timed mock, or the adaptive **Skill Builder**. The child answers; when stuck, an **AI tutor** streams a step-by-step method without giving the answer away. At the end the score is instant, every wrong answer gets an **AI explanation**, and the parent gets a dashboard topped with an **AI-written plain-English summary** — because busy parents need answers, not more charts.

It's a real product, not a demo: Cognito accounts, Stripe subscriptions, an admin console, and UK GDPR compliance are all built and running.

## The architecture, briefly

![ApexMaths architecture](ApexMaths-Architecture.drawio.png)
*Vercel is the entire backend; AWS holds data, identity, and AI. (Upload `ApexMaths-Architecture.drawio.png` when posting.)*

**Vercel is the whole backend.** There's no separate API server. Every privileged operation — auth, database, billing, AI — runs server-side in Next.js Server Components, Server Actions, and Route Handlers. The browser is a thin client that never holds a secret and **never sees an answer key**: a question is sent to the client with its correct index stripped out, grading is server-authoritative, and the timer is enforced on the server. You can't cheat the UI because the UI doesn't know anything worth cheating.

**The data layer is Amazon Aurora PostgreSQL (Serverless v2), over the RDS Data API.** I chose it deliberately: my workload is joins, aggregates, and transactions — choosing questions, rolling answers into per-topic mastery, and erasing an account as one cascading delete across ten foreign keys. That's not a single partition key, so DynamoDB was the wrong tool; and serving one UK market, I didn't need Aurora DSQL's multi-region writes. The RDS Data API lets a serverless function reach a *private* Postgres database over HTTPS — **no connection pool to exhaust, no VPC to enter, and no database password in my code.**

**Security with no standing secrets.** Vercel reaches AWS through OIDC federation — short-lived credentials, no static keys anywhere. The app holds only a Secrets Manager ARN, and the database role it uses can only do DML, never own the schema.

**AI: one model, three jobs.** The tutor hints, the per-question review, and the parent summary all run on **Claude Sonnet 4.6 via Amazon Bedrock**, through the EU regional inference profile in London. A PII firewall keeps names and emails out of every prompt.

## The part I'm proudest of: the adaptive engine

The Skill Builder is a **pure, deterministic function** behind a thin data service — which is exactly why I could property-test it instead of hoping it worked. It concentrates practice where the child is weakest (inverse-mastery weighting), turns those weights into whole-question counts with a coverage floor so every topic stays warm, and targets difficulty at the child's "zone of proximal development" — the band where they score around 75%. The same relational analytics that *report* progress now *drive* what the child practises next. So as the product gets smarter, the database does **more** work, not less — the opposite of what a key-value store would push you toward.

And the "silly mistake" problem that broke my paper system? A topic isn't classified until at least ten graded attempts, and mastery is a cumulative ratio — so one unlucky tick can't swing the verdict.

## A bonus build: trustworthy question generation

The questions themselves had to be trustworthy — a wrong "correct" answer teaches a child the wrong thing. So I built an offline pipeline where **three independent AI model families** propose and check each question: one model writes it, a second (different family) solves it *cold* without seeing the proposed answer, and a third adjudicates only when they disagree. Deterministic code — not a model — decides "approved" vs "needs review," and a human makes the final call on anything flagged. The approved questions seed the Aurora question bank.

![Question-generation pipeline](QuestionGenerationPipeline-Architecture.drawio.png)
*Three models propose, code judges, a human disposes. (Upload `QuestionGenerationPipeline-Architecture.drawio.png` when posting.)*

## What I learned

- **Pick the database for the access patterns, not the hype.** Saying *why Aurora — and why not DynamoDB or DSQL* taught me more than any feature did.
- **The RDS Data API is the unlock for serverless + relational.** No pool, no VPC, no password is genuinely freeing.
- **Property-based testing earns its keep** the moment the logic gets non-trivial.
- And the product lesson: **data without interpretation doesn't help a tired parent** — the AI summary that reads the dashboard *for* you is the feature my past self actually needed.

I built the whole thing solo, and it's past MVP. A child's chances should come down to their effort and potential — not whether their parents can afford a tutor.

---

*Built for **H0: Hack the Zero Stack with Vercel v0 and AWS Databases**. I created this content for the purposes of entering the H0 hackathon.* **#H0Hackathon**
