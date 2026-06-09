/**
 * DESTRUCTIVE: wipe all user/billing data from Aurora for a clean test run.
 *
 * Deletes every parent (FK ON DELETE CASCADE removes subscriptions, children,
 * sessions, session_answers, progress, review_reports), clears the audit log,
 * the processed-webhook-events dedupe table, the revenue ledger, and resets the
 * singleton revenue summary. The question bank is LEFT INTACT.
 *
 * Clearing processed_webhook_events lets you re-run the full Stripe flow from
 * scratch — old event ids will be reprocessed instead of suppressed.
 *
 * Usage:
 *   node scripts/wipe-users.mjs            # dry run (counts only)
 *   node scripts/wipe-users.mjs --apply    # perform the wipe
 *
 * Required env: AURORA_CLUSTER_ARN, AURORA_SECRET_ARN, AURORA_DATABASE,
 * AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
 */
import { RDSDataClient, ExecuteStatementCommand } from "@aws-sdk/client-rds-data"

const { AURORA_CLUSTER_ARN, AURORA_SECRET_ARN } = process.env
const database = process.env.AURORA_DATABASE ?? "apex"
const region = process.env.AWS_REGION ?? "eu-west-2"

if (!AURORA_CLUSTER_ARN || !AURORA_SECRET_ARN) {
  console.error("Missing AURORA_CLUSTER_ARN / AURORA_SECRET_ARN.")
  process.exit(1)
}

const apply = process.argv.includes("--apply")
const client = new RDSDataClient({ region })
async function run(sql) {
  return client.send(
    new ExecuteStatementCommand({ resourceArn: AURORA_CLUSTER_ARN, secretArn: AURORA_SECRET_ARN, database, sql }),
  )
}
function count(out) {
  const r = (out.records ?? [])[0]?.[0]
  return Number(r?.longValue ?? r?.stringValue ?? 0)
}

// Report what is there now.
const tables = [
  "parents",
  "subscriptions",
  "children",
  "sessions",
  "session_answers",
  "progress",
  "review_reports",
  "audit_log",
  "processed_webhook_events",
  "revenue_events",
]
console.log("Current row counts:")
for (const t of tables) {
  console.log(`  ${t.padEnd(26)} ${count(await run(`SELECT count(*) FROM ${t}`))}`)
}
console.log(`  questions (KEPT)           ${count(await run(`SELECT count(*) FROM questions`))}`)

if (!apply) {
  console.log("\nDry run. Re-run with --apply to wipe all user/billing data (questions kept).")
  process.exit(0)
}

// Delete in FK-safe order (cascades cover most, but be explicit for the
// non-cascading / SET NULL tables).
console.log("\nWiping…")
await run(`DELETE FROM revenue_events`)
await run(`UPDATE revenue_summary SET total_revenue_pence = 0, paying_parent_count = 0, first_paid_at = NULL, updated_at = now() WHERE id = 'current'`)
await run(`DELETE FROM processed_webhook_events`)
await run(`DELETE FROM audit_log`)
// parents cascade removes subscriptions, children, sessions, session_answers,
// progress, review_reports.
const del = await run(`DELETE FROM parents`)
console.log(`Deleted ${del.numberOfRecordsUpdated ?? "?"} parent row(s) (cascade removed owned data).`)

console.log("\nPost-wipe row counts:")
for (const t of tables) {
  console.log(`  ${t.padEnd(26)} ${count(await run(`SELECT count(*) FROM ${t}`))}`)
}
console.log(`  questions (KEPT)           ${count(await run(`SELECT count(*) FROM questions`))}`)
console.log("\nDone. Cognito users are NOT touched by this script — delete those separately if needed.")
