# ApexMaths — On-screen Caption Overlays

Short text overlays to reinforce the stack and key points while Joanna narrates.
Use sparingly (lower-third style), one line at a time. Two formats:
- This file = human-readable, grouped per scene (relative cues).
- `apexmaths_captions.srt` = importable subtitle track timed to the **combined**
  `apexmaths_voiceover.mp3`. If you add demo holds, nudge the later cues to match.

Tagging the AWS services as they're mentioned (Cognito, OIDC, Aurora, RDS Data
API) is what the judges' QA asked for — it makes the integration visible.

---

## Scene 1 — Impact (0:00–0:22)
- The 11+ — England's grammar-school entrance exam
- Top prep usually means costly 1:1 tutoring
- **ApexMaths — AI-powered 11+ maths, for every family**

## Scene 2 — Design (0:22–1:14)
- Skill Builder — adaptive engine
- Targets weakest topics · ~75% difficulty (ZPD)
- "Show me how" — streaming AI tutor (never reveals the answer)
- Instant score + per-question AI review
- Live analytics: mastery, accuracy, focus areas
- **AI writes a plain-English summary for the parent**

## Scene 3 — Technical implementation (1:14–2:51)
- Cognito · Stripe · Admin — all server-side on Vercel
- Vercel ↔ AWS via **OIDC federation** — no static keys
- Vercel env → `AWS_ROLE_ARN` + `AURORA_CLUSTER_ARN`
- IAM trust policy = the Vercel OIDC identity
- **Same ARN in Vercel & AWS console ✓**
- Amazon Aurora PostgreSQL Serverless v2
- Why, not which → DynamoDB: KV at scale · DSQL: global writes · Aurora: relational
- Relational core: joins · aggregates · transactions · 10 foreign keys
- Window functions — computed live, in-engine
- RDS Data API over HTTPS — no pool · no VPC · no password

## Scene 4 — Originality (2:51–3:14)
- New idea? No. New approach? Yes.
- Adaptive tutor · AI review · self-explaining analytics
- Effort & potential — not postcode
- **Built solo · ApexMaths**
