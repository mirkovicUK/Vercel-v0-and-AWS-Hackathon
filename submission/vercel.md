# Vercel — From Static Host to Full-Stack Orchestration Layer

**Judging criterion addressed:** *"Does the Vercel deployment go beyond a basic setup?"*

**Short answer:** ApexMaths has **no separate backend server**. Vercel *is* the
application execution layer. Every privileged operation — authentication, database
access, billing, and AI — runs inside Next.js Server Components, Server Actions,
and Route Handlers on Vercel, which orchestrate Amazon Cognito, Aurora, Bedrock,
and Stripe. The browser never holds a secret, never sees an answer key, and never
talks to a database. Vercel is the secure compute tier that a basic setup would
leave to a static frontend plus a pile of client-side API calls.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · deployed on Vercel.

---

## What "basic" would look like — and what we did instead

| Basic Vercel setup | ApexMaths |
|---|---|
| Static/SSR pages, data fetched client-side | **Server Components** fetch live data per request; secrets stay server-only |
| API keys shipped to the browser or a third-party BaaS | **Server Actions + Route Handlers** are the backend; all 4 SDKs (Cognito, RDS Data API, Bedrock, Stripe) run server-side |
| Auth via a drop-in widget | **Layered server-side gates** (`requireParent → requireOnboardedParent → requireEntitledParent`) enforced in the route-group layout |
| One generic serverless function | **Per-route runtime tuning**: `runtime = "nodejs"`, `maxDuration = 60`, `dynamic = "force-dynamic"` where each is actually needed |
| Request/response only | **Streaming** AI responses and **webhook ingestion** with signature verification + idempotency |

---

## The five layers Vercel orchestrates

```mermaid
flowchart TB
    subgraph BROWSER["👤 Browser (thin client — no secrets, no answer keys)"]
        UI["React 19 UI · streamed hints · optimistic grading"]
    end

    subgraph VERCEL["▲ Vercel — Next.js application execution layer"]
        direction TB
        RSC["1 · Frontend<br/>Server Components (per-request render)<br/>+ client components"]
        AUTH["2 · Auth gate<br/>(app)/layout.tsx → requireParent()<br/>httpOnly cookies · JWT verify (JWKS)"]
        ACTIONS["Server Actions ('use server')<br/>practice · billing · children · account · auth"]
        HELP["Route Handler /api/practice/help<br/>runtime=nodejs · streaming"]
        HOOK["Route Handler /api/stripe/webhook<br/>force-dynamic · signed · idempotent"]
    end

    DB[("3 · Aurora<br/>RDS Data API")]
    COG["2 · Cognito"]
    AI["5 · Bedrock<br/>Claude Sonnet 4.6"]
    PAY["4 · Stripe"]

    UI <--> RSC
    UI <-->|token stream| HELP
    RSC --> AUTH
    AUTH <--> COG
    RSC --> ACTIONS
    ACTIONS <--> DB
    ACTIONS <-->|checkout / portal| PAY
    ACTIONS <-->|inline review (≤maxDuration)| AI
    HELP <-->|streamText| AI
    HELP --> DB
    PAY -->|webhook| HOOK
    HOOK --> DB
```

### 1 — Frontend (rendered on the server, per request)
Pages that depend on live subscription state are `dynamic = "force-dynamic"`
(`dashboard`, `billing`, `account`, the practice player) so entitlement is read
fresh on every request rather than cached. The UI is a thin React 19 client:
Tailwind v4 + Radix primitives, `@vercel/analytics` enabled in production only.

The **child analytics dashboard** is a good example of the Server-Component model:
it issues several live Aurora queries in parallel on the server (mastery-over-time
window function, accuracy-by-difficulty join, correct/wrong/skipped `FILTER`
aggregate, and a `LAG()` improvement-velocity series) and ships only rendered
charts (recharts) to the browser — the analytical SQL never leaves the server, and
there's no separate analytics API. A past session opens in a dialog backed by a
single read-only Server Action that reconstructs it with one foreign-key join.

### 2 — Auth (Cognito, enforced server-side)
Authentication is composed in layers and enforced *before* a page renders. The
`(app)` route-group layout calls `requireParent()`, so every protected page
inherits the gate. Three tiers escalate the check:

```
requireParent          → signed in?            (else redirect /sign-in)
requireOnboardedParent → guardian/age attested? (else redirect /onboarding)
requireEntitledParent  → live Stripe entitlement? (else redirect /billing, audited)
```

Sessions are httpOnly cookies; the Cognito id token is verified on every request
with `aws-jwt-verify` against the pool's JWKS and **transparently refreshed** when
expired. No token is ever exposed to client JavaScript.

### 3 — Database (Aurora via the RDS Data API)
Server Actions and Server Components call Aurora over the **RDS Data API** (HTTPS,
IAM + Secrets Manager) through a typed wrapper with real transactions. The browser
has no database connection and no credentials. (Full rationale in
[`database.md`](./database.md).)

### 4 — Billing (Stripe, server-authoritative)
Server Actions create **Stripe-hosted Checkout and Customer Portal** sessions —
the payment page lives on Stripe's domain, so no card data touches our compute.
Redirect URLs are derived from `x-forwarded-host` so the same code works across
preview and production deployments. Inbound `/api/stripe/webhook` verifies the
Stripe signature (raw body, `force-dynamic`), **de-duplicates** events via a
`processed_webhook_events` table, and returns 500 on handler failure so Stripe
retries — entitlement is driven entirely by these server-verified events, never by
the client.

### 5 — AI (Bedrock, two execution shapes)
- **Streaming hints:** `/api/practice/help` (`runtime = "nodejs"`) streams Claude
  Sonnet 4.6 tokens straight to the browser via `toTextStreamResponse()`. Repeat
  hints are **adaptive** — the route takes the previously shown explanations and
  asks the model for a genuinely different (still correct) approach.
- **Post-session review, off the critical path:** `finishSessionAction` persists
  the deterministic skeleton (score, per-topic summary, fallback text) and then
  **redirects immediately**, scheduling the per-question Bedrock calls in
  **Next.js `after()`** — work that runs *after* the response is sent, which Vercel
  keeps the function alive to complete (the practice route allows `maxDuration =
  60`). The result page renders instantly and **auto-refreshes** while the review
  is `pending`, so the explanations stream in without the parent ever waiting. This
  is a deliberate use of the platform: rather than block on ~5s of model latency,
  the user-facing wait is just the deterministic finalize, and the AI fills in
  behind it. If the background work fails it falls back to deterministic text, so
  the report never hangs.

---

## Engineering details that mark it as deliberate

- **Single security boundary.** `server-only` guards keep DB, auth, AI, and Stripe
  code out of the client bundle. An **answer firewall** (`toClientQuestion`) strips
  `correctIndex` before any question is serialised mid-session; grading is
  server-authoritative and idempotent (first answer wins), with server-enforced
  timer expiry.
- **Per-route runtime decisions, not defaults.** `nodejs` runtime for the AI SDK,
  `maxDuration = 60` only where inline AI needs it, `force-dynamic` only where
  per-request freshness matters.
- **Cache coherence.** Mutations call `revalidatePath('/dashboard')` so server-rendered
  data stays consistent immediately after writes.
- **Deploy-portable.** Origin/redirect URLs are derived from forwarded headers, so
  preview and production deploys work without per-environment config changes.

---

## Do we need a separate Vercel architecture diagram?

**No — it's already covered.** The mandatory architecture diagram in
[`architecture_diagram.md`](./architecture_diagram.md) shows how the Vercel
deployment connects to every AWS component and Stripe (the system *topology*),
which is exactly what the submission requirement asks for. The Mermaid diagram in
this document is a complementary, *internal* view — how Vercel composes the five
execution layers — and is optional supporting material, not a second required
submission image.
