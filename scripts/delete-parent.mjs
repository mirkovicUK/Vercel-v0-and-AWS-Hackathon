/**
 * One-off maintenance: hard-delete a specific parent row by id.
 *
 * Guardrails: refuses to delete a parent that has a subscription row or a
 * stripe_customer_id, so the active/paying account can never be removed by
 * mistake. FK ON DELETE CASCADE removes the parent's owned rows (children,
 * sessions, etc.). This does NOT touch Cognito or Stripe.
 *
 * Usage:
 *   node scripts/delete-parent.mjs <parentId>            # dry run (shows what would go)
 *   node scripts/delete-parent.mjs <parentId> --apply    # perform the delete
 *   node scripts/delete-parent.mjs <parentId> --apply --force  # bypass the safety checks
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

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const force = args.includes("--force")
const parentId = args.find((a) => !a.startsWith("--"))

if (!parentId) {
  console.error("Pass a parent id: node scripts/delete-parent.mjs <parentId> [--apply] [--force]")
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
const idParam = [{ name: "id", value: { stringValue: parentId } }]

// 1. Load the parent.
const parent = await run(
  `SELECT id, email, stripe_customer_id FROM parents WHERE id = :id`,
  idParam,
)
const prow = (parent.records ?? [])[0]
if (!prow) {
  console.log(`No parent with id ${parentId}.`)
  process.exit(0)
}
const email = f(prow[1])
const customerId = f(prow[2])

// 2. Count owned rows that the cascade would remove.
const subs = await run(`SELECT count(*) FROM subscriptions WHERE parent_id = :id`, idParam)
const kids = await run(`SELECT count(*) FROM children WHERE parent_id = :id`, idParam)
const subCount = Number(f((subs.records ?? [])[0]?.[0]) ?? 0)
const kidCount = Number(f((kids.records ?? [])[0]?.[0]) ?? 0)

console.log(`Parent ${parentId}`)
console.log(`  email:               ${email}`)
console.log(`  stripe_customer_id:  ${customerId ?? "(none)"}`)
console.log(`  subscriptions:       ${subCount}`)
console.log(`  children:            ${kidCount}`)

// 3. Safety checks (skippable with --force).
const blockers = []
if (subCount > 0) blockers.push(`has ${subCount} subscription row(s)`)
if (customerId) blockers.push(`has a stripe_customer_id (${customerId})`)
if (blockers.length && !force) {
  console.error(`\nREFUSING to delete: ${blockers.join("; ")}. Use --force to override.`)
  process.exit(1)
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to delete this parent (FK cascade removes owned rows).")
  process.exit(0)
}

// 4. Delete (cascade handles children/sessions/etc.).
const del = await run(`DELETE FROM parents WHERE id = :id`, idParam)
console.log(`\nDeleted ${del.numberOfRecordsUpdated ?? 1} parent row. Cascade removed any owned rows.`)
