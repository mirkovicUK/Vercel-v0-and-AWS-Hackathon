/**
 * One-off diagnostic: dump billing-related state for a parent so we can trace
 * why a completed checkout did not produce an entitlement.
 *
 * Usage:
 *   node scripts/inspect-billing-state.mjs uros1311@gmail.com
 */
import { RDSDataClient, ExecuteStatementCommand } from "@aws-sdk/client-rds-data"

const { AURORA_CLUSTER_ARN, AURORA_SECRET_ARN } = process.env
const database = process.env.AURORA_DATABASE ?? "apex"
const region = process.env.AWS_REGION ?? "eu-west-2"
const email = process.argv.slice(2).find((a) => !a.startsWith("--"))

if (!AURORA_CLUSTER_ARN || !AURORA_SECRET_ARN) {
  console.error("Missing AURORA_CLUSTER_ARN / AURORA_SECRET_ARN.")
  process.exit(1)
}
if (!email) {
  console.error("Pass a parent email: node scripts/inspect-billing-state.mjs <email>")
  process.exit(1)
}

const client = new RDSDataClient({ region })
async function run(sql, parameters) {
  return client.send(
    new ExecuteStatementCommand({ resourceArn: AURORA_CLUSTER_ARN, secretArn: AURORA_SECRET_ARN, database, sql, parameters }),
  )
}
function f(v) {
  if (v == null) return null
  if (v.stringValue !== undefined) return v.stringValue
  if (v.longValue !== undefined) return v.longValue
  if (v.booleanValue !== undefined) return v.booleanValue
  if (v.isNull) return null
  return null
}
function dump(label, out) {
  const rows = out.records ?? []
  console.log(`\n=== ${label} (${rows.length}) ===`)
  for (const r of rows) console.log("  " + r.map(f).join(" | "))
}

const parent = await run(
  `SELECT id, email, stripe_customer_id, has_used_trial FROM parents WHERE email = :e`,
  [{ name: "e", value: { stringValue: email } }],
)
dump("parents [id | email | stripe_customer_id | has_used_trial]", parent)
const pid = f((parent.records ?? [])[0]?.[0])
if (!pid) {
  console.log("No parent row for that email.")
  process.exit(0)
}

dump(
  "subscriptions [id | status | stripe_subscription_id | current_period_end | trial_end]",
  await run(
    `SELECT id, status, stripe_subscription_id, current_period_end, trial_end FROM subscriptions WHERE parent_id = :p`,
    [{ name: "p", value: { stringValue: pid } }],
  ),
)

dump(
  "processed_webhook_events (recent 10) [event_id | type]",
  await run(`SELECT event_id, type FROM processed_webhook_events ORDER BY ctid DESC LIMIT 10`, []),
)

dump(
  "audit (recent 15 for parent) [action | created_at]",
  await run(
    `SELECT action, created_at FROM audit_log WHERE parent_id = :p ORDER BY created_at DESC LIMIT 15`,
    [{ name: "p", value: { stringValue: pid } }],
  ),
)
