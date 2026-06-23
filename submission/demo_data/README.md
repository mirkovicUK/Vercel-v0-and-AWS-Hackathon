# ApexMaths — Demo Data Generator

Generates rich, realistic practice history for the demo account so the parent
dashboard, analytics charts, and admin views are full for the submission video.

## Target account
- **Parent:** `uros1311@gmail.com` (`d68272f4-d061-70a6-0186-c5ee1aa779cc`)
- **Children (already exist):**
  | Child | id | Year | Target overall mastery |
  |---|---|---|---|
  | Nina  | `7a30eaa2-fdba-4069-8e52-64bbe5791889` | 6 | ~85% (strong) |
  | Amara | `506c640c-5340-4537-850e-fa9681ab073f` | 5 | ~50% (developing) |
  | Lui   | `4ab8cb02-23fe-47f1-b5ac-ebc9b2423623` | 4 | ~30% (needs focus) |

## What it produces (1 Jun 2026 – 22 Jun 2026)
- **Daily practice**, mostly one session per day, sometimes two or three — a
  natural mix of session types (Warm-up, Practice-a-topic, Full mock, Skill
  builder), covering all six topics so every chart has data.
- Per-answer correctness drawn from each child's target accuracy, with small
  **per-topic strengths/weaknesses** and a gentle **upward trend** over the
  month (so "mastery over time" and "improvement velocity" tell a positive
  story). A few sessions **expire** with trailing **skipped** questions.
- Rows written across **all the tables the dashboard reads**:
  - `sessions` (status `completed`, a few `expired`)
  - `session_answers` (graded + some skipped)
  - `progress` (per-topic rollup: attempts, correct, mastery_score, classification)
  - `review_reports` (deterministic fallback summary per completed session, so
    session-detail pages and the admin "review reports" metric are populated)
- Also sets each child's `year_group` (6 / 5 / 4) for nicer profiles.

## Safety / idempotency
Before inserting, the script **deletes existing `sessions` and `progress` for
these three child IDs only** (sessions cascade to `session_answers` and
`review_reports`). It touches no other account. Re-running reproduces the same
data (seeded RNG), so it is safe to run repeatedly.

## Run
These scripts read the Aurora connection from the environment only (no ARNs are
hardcoded in the repo). Set them first — prefer the **least-privilege app-user
secret**, not the master/schema-owner secret:

```bash
cd submission/demo_data

# Discover the values (or copy from your CDK stack outputs):
export AWS_REGION=eu-west-2
export AURORA_CLUSTER_ARN=$(aws rds describe-db-clusters --region "$AWS_REGION" \
  --query "DBClusters[?DatabaseName=='apex'].DBClusterArn | [0]" --output text)
export AURORA_SECRET_ARN=$(aws secretsmanager list-secrets --region "$AWS_REGION" \
  --query "SecretList[?Name=='apexmaths/app-user-credentials'].ARN | [0]" --output text)

node generate_demo_data.mjs          # children: clears + regenerates the 3 kids
node generate_demo_data.mjs --verify # print resulting per-topic mastery summary
node seed_admin_data.mjs             # admin: revenue + contact + demo customers
node seed_admin_data.mjs --wipe      # remove only the demo-tagged admin rows
```

Requires active AWS credentials with RDS Data API access. Nothing secret (no
keys, no DB password, no ARNs) is committed — all connection details come from
the environment at run time.
