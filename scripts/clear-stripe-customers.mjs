/**
 * One-off maintenance: clear stale Stripe customer ids from the parents table.
 *
 * Why: parents.stripe_customer_id caches a Stripe customer (cus_...) created on
 * the parent's first checkout. If the Stripe key/mode later changes (test→live,
 * or a reset of test data), those cached ids point at customers that no longer
 * exist under the current key, so checkout fails with "No such customer".
 * Nulling the column makes the next checkout create a fresh customer under the
 * current key and re-save it (self-healing).
 *
 * Usage:
 *   node scripts/clear-stripe-customers.mjs                 # list affected rows (dry run)
 *   node scripts/clear-stripe-customers.mjs --apply         # clear ALL stripe_customer_id values
 *   node scripts/clear-stripe-customers.mjs --apply cus_X   # clear only the given customer id
 *
 * Required env: AURORA_CLUSTER_ARN, AURORA_SECRET_ARN, AURORA_DATABASE,
 * AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
 */
import { RDSDataClient, ExecuteStatementCommand } from "@aws-sdk/client-rds-data"

const { AURORA_CLUSTER_ARN, AURORA_SECRET_ARN } = process.env
const database = process.env.AURORA_DATABASE ?? "apex"
const region = process.env.AWS_REGION ?? "eu-west-2"

if (!AURORA_CLUSTER_ARN || !AURORA_SECRET_ARN) {
  console.error("Missing AURORA_CLUSTER_ARN / AURORA_SECRET_ARN. Set env vars first.")
  process.exit(1)
}

const apply = process.argv.includes("--apply")
// First non-flag arg after the script is an optional specific customer id.
const targetCustomerId = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? null

const client = new RDSDataClient({ region })

async function run(sql, parameters) {
  const out = await client.send(
    new ExecuteStatementCommand({
      resourceArn: AURORA_CLUSTER_ARN,
      secretArn: AURORA_SECRET_ARN,
      database,
      sql,
      parameters,
    }),
  )
  return out
}

function field(v) {
  if (v == null) return null
  if (v.stringValue !== undefined) return v.stringValue
  if (v.longValue !== undefined) return v.longValue
  if (v.booleanValue !== undefined) return v.booleanValue
  if (v.isNull) return null
  return null
}

const where = targetCustomerId
  ? `stripe_customer_id = :cid`
  : `stripe_customer_id IS NOT NULL`
const params = targetCustomerId ? [{ name: "cid", value: { stringValue: targetCustomerId } }] : undefined

// 1. Show what will be affected.
const sel = await run(
  `SELECT id, email, stripe_customer_id FROM parents WHERE ${where} ORDER BY created_at`,
  params,
)
const rows = (sel.records ?? []).map((r) => ({
  id: field(r[0]),
  email: field(r[1]),
  stripeCustomerId: field(r[2]),
}))

if (rows.length === 0) {
  console.log(targetCustomerId ? `No parent has customer ${targetCustomerId}.` : "No parents have a stripe_customer_id.")
  process.exit(0)
}

console.log(`Affected parents (${rows.length}):`)
for (const row of rows) {
  console.log(`  ${row.email}  ->  ${row.stripeCustomerId}`)
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to clear these stripe_customer_id values.")
  process.exit(0)
}

// 2. Clear the cached customer id(s).
const upd = await run(`UPDATE parents SET stripe_customer_id = NULL WHERE ${where}`, params)
const affected = upd.numberOfRecordsUpdated ?? rows.length
console.log(`\nCleared stripe_customer_id on ${affected} parent row(s). Next checkout will create a fresh Stripe customer.`)
