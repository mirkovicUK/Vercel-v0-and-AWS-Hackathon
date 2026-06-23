# ApexMaths — Demo Video Voiceover Script

**Voice:** Amazon Polly — Joanna (US English), Generative engine (most natural), Neural as fallback.
**Perspective:** First person, solo developer.
**Rendered length:** **191.9s (3:11.9)** combined track.

> ⚠️ **Length warning:** the current track is **3:12**, still **over the 3:00 hard
> limit**. Scene 4 (originality + close) falls in the cut-off zone. Trim ~15s
> (Scene 3 is 95s) to be safe. Kept at this length per explicit request.

The four scenes map **directly onto the four judging criteria**:

| Scene | Judging criterion | Length | Combined timecode |
|---|---|---|---|
| 1 | **Impact & real-world applicability** | 22.1s | 0:00–0:22 |
| 2 | **Design** | 51.6s | 0:22–1:14 |
| 3 | **Technical implementation** (+ DB rationale, OIDC integration) | 95.2s | 1:14–2:49 |
| 4 | **Originality** | 23.1s | 2:49–3:12 |

Each scene renders to its own MP3 (`scene1.mp3` … `scene4.mp3`); sync each to its
footage. `apexmaths_voiceover.mp3` is the combined reference track. On-screen
caption overlays: see `captions.md` and `apexmaths_captions.srt`.

> Pronunciation note: acronyms (OIDC, ARN, RDS, VPC, DSQL, HTTPS) are written as
> spaced letters in the SSML (e.g. "O I D C", "A R N") so they read as letters on
> both engines. "ApexMaths" is written "Apex Maths".

---

## SCENE 1 — Impact: the problem & who it's for  (~0:00–0:22)
**On screen:** Live landing page hero; gentle scroll.

> In England, a place at a state grammar school comes down to one exam — the eleven-plus. It's fiercely competitive, and strong preparation has always meant expensive one-to-one tutoring that many families simply can't reach. I built ApexMaths to change that — using AI to make high-quality eleven-plus maths preparation accessible to every family.

---

## SCENE 2 — Design: the app in action  (~0:22–1:14)
**On screen:** Screen recording. Hold footage where the script pauses.
Click-path: dashboard → start Skill Builder (show "today's mix") → a question →
"Show me how" (let the hint **stream**) → finish → instant score + review → child
analytics dashboard, ending on the **AI plain-English summary** at the top.

> Here's the parent's view. I'll start a Skill Builder session — my adaptive engine. It builds today's mix from this child's weakest topics, pitched at the difficulty where they score around seventy-five percent.
>
> Here's a question. When my child gets stuck, they tap "Show me how" — and an AI tutor streams a step-by-step explanation that teaches the method without ever giving away the answer.
>
> When the test ends, the score is instant, and a per-question review explains everything they missed.
>
> The dashboard tracks mastery over time, accuracy by difficulty, and each topic's strengths and gaps. But a full analytics dashboard can overwhelm a busy parent — so at the top, AI reads all of it and writes a plain-English summary of how their child is really doing, and exactly what to work on next.

---

## SCENE 3 — Technical implementation & the database  (~1:14–2:51)
**On screen, in order, synced to the narration:**
1. Quick flashes: sign-in (Cognito), billing (Stripe), the admin dashboard.
2. **OIDC integration walkthrough** (the proof of the Vercel↔AWS connection):
   - Vercel → OIDC enabled, then Env Vars showing `AWS_ROLE_ARN` + `AURORA_CLUSTER_ARN`.
   - AWS console → IAM role **Trust relationships** showing the Vercel OIDC issuer + `sub` condition.
   - AWS console → RDS → the Aurora cluster showing the **same ARN** (highlight the match).
3. A **live dashboard query** (or the mastery-over-time chart) to anchor "in the engine".

> Now, the engineering. ApexMaths is a complete, deployable product — Cognito authentication, Stripe billing, UK GDPR compliant, and an admin dashboard that runs the whole business, all server-side on Vercel with no separate backend.
>
> Vercel reaches my AWS account with no static keys — through OIDC federation. OIDC is enabled in Vercel, the environment points at my database by ARN, and in the AWS console the role's trust policy accepts exactly that Vercel identity, scoped to this Aurora cluster. And that role can reach only one database user — an app-user granted create, read, update and delete, never schema ownership — so least privilege is enforced at the database itself.
>
> The database is Aurora Postgres — and the choice was deliberate. ApexMaths is relational to its core: choosing questions, rolling answers into per-topic mastery, and erasing an account as one cascading delete across ten foreign keys. Those are joins, aggregates, and transactions, not a single partition key. This dashboard query computes mastery trends with window functions live, in the engine. Serving one UK market, I didn't need DSQL's multi-region writes. And the RDS Data API reaches a private database over HTTPS — no connection pool, no VPC, and no password anywhere in my code.

---

## SCENE 4 — Originality & close  (~2:51–3:14)
**On screen:** Back to a clean product shot / logo.

> My idea isn't new — families have prepared for the eleven-plus for decades. What's new is the approach: an adaptive tutor, an AI review of every mistake, and analytics that explain themselves in plain English. A child's chances should come down to their effort and potential — not their postcode. I built the whole thing solo. Thanks for watching.

---

## If you decide to trim under 3:00 (recommended)
Quickest ~20s without losing substance — tighten Scene 3:
- Drop "and the choice was deliberate." (the next line makes the point).
- Drop "Serving one UK market, I didn't need DSQL's multi-region writes." (DSQL is
  already covered in the "why, not which" line).
- Shorten the close of the DB section to: "…not a single partition key — computed
  live, in the engine. And the RDS Data API reaches it over HTTPS: no connection
  pool, no VPC, no password in my code."
Then regenerate (see below). That lands the track ~2:52.

## Regenerating
Edit the `ssml/*.ssml` files, then from `submission/video/`:
```bash
ENGINE=generative AWS_REGION=us-east-1 ./generate_voiceover.sh
```
(Generative isn't offered in eu-west-2, so it renders via us-east-1 — same Joanna voice.)
