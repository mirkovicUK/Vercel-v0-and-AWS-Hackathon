/**
 * Apply SQL migrations to Aurora via the Data API.
 *
 * Usage (after AWS is provisioned and env vars are set):
 *   node scripts/migrate.mjs
 *
 * Required env: AURORA_CLUSTER_ARN, AURORA_SECRET_ARN, AURORA_DATABASE,
 * AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
 */
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { RDSDataClient, ExecuteStatementCommand } from "@aws-sdk/client-rds-data"

const __dirname = dirname(fileURLToPath(import.meta.url))
const sqlDir = join(__dirname, "sql")

const { AURORA_CLUSTER_ARN, AURORA_SECRET_ARN } = process.env
const database = process.env.AURORA_DATABASE ?? "apex"
const region = process.env.AWS_REGION ?? "eu-west-2"

if (!AURORA_CLUSTER_ARN || !AURORA_SECRET_ARN) {
  console.error("Missing AURORA_CLUSTER_ARN / AURORA_SECRET_ARN. Set env vars first.")
  process.exit(1)
}

const client = new RDSDataClient({ region })

/** Split SQL into statements, respecting $$ dollar-quoted blocks and ' strings. */
function splitSql(sql) {
  const statements = []
  let current = ""
  let inSingle = false
  let inDollar = false
  for (let i = 0; i < sql.length; i++) {
    const two = sql.slice(i, i + 2)
    if (!inSingle && two === "$$") {
      inDollar = !inDollar
      current += two
      i++
      continue
    }
    const ch = sql[i]
    if (!inDollar && ch === "'") inSingle = !inSingle
    if (!inSingle && !inDollar && ch === ";") {
      const trimmed = current.trim()
      if (trimmed) statements.push(trimmed)
      current = ""
      continue
    }
    current += ch
  }
  if (current.trim()) statements.push(current.trim())
  return statements
}

async function run() {
  const files = readdirSync(sqlDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  for (const file of files) {
    const sql = readFileSync(join(sqlDir, file), "utf8")
    const statements = splitSql(sql)
    console.log(`\n→ ${file} (${statements.length} statements)`)
    for (const statement of statements) {
      await client.send(
        new ExecuteStatementCommand({
          resourceArn: AURORA_CLUSTER_ARN,
          secretArn: AURORA_SECRET_ARN,
          database,
          sql: statement,
        }),
      )
      process.stdout.write(".")
    }
    console.log(" done")
  }
  console.log("\nMigrations applied successfully.")
}

run().catch((err) => {
  console.error("\nMigration failed:", err)
  process.exit(1)
})
