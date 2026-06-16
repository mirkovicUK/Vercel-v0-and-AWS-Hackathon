/**
 * Provision the least-privilege application DB role (`app_user`).
 *
 * WHY: the app must not connect to Aurora as the schema owner (apexadmin). This
 * script creates a dedicated `app_user` Postgres role that holds ONLY DML
 * privileges (SELECT/INSERT/UPDATE/DELETE) on the application tables — no DDL,
 * no DROP, no ownership. The app then authenticates as this role via the RDS
 * Data API using the `apexmaths/app-user-credentials` secret.
 *
 * HOW IT RUNS: as the MASTER user (apexadmin) over the Data API — only the owner
 * can CREATE ROLE and GRANT. It reads the app_user password from the app_user
 * secret (so the password lives only in Secrets Manager + the DB, never here).
 *
 * IDEMPOTENT: safe to re-run. Creates the role if missing, (re)sets its password
 * (this is also the rotation path), and re-applies the grants.
 *
 * Usage (run locally, with admin AWS creds):
 *   AURORA_CLUSTER_ARN=<cluster arn> \
 *   AURORA_SECRET_ARN=<MASTER secret arn> \
 *   APP_USER_SECRET_ARN=<app_user secret arn> \
 *   AURORA_DATABASE=apex AWS_REGION=eu-west-2 \
 *   node scripts/create-app-user.mjs
 */
import { RDSDataClient, ExecuteStatementCommand } from "@aws-sdk/client-rds-data"
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager"

const { AURORA_CLUSTER_ARN, AURORA_SECRET_ARN, APP_USER_SECRET_ARN } = process.env
const database = process.env.AURORA_DATABASE ?? "apex"
const region = process.env.AWS_REGION ?? "eu-west-2"

if (!AURORA_CLUSTER_ARN || !AURORA_SECRET_ARN) {
  console.error("Missing AURORA_CLUSTER_ARN / AURORA_SECRET_ARN (the MASTER secret, to run as apexadmin).")
  process.exit(1)
}
if (!APP_USER_SECRET_ARN) {
  console.error("Missing APP_USER_SECRET_ARN (the app_user secret to read the generated password from).")
  process.exit(1)
}

const rds = new RDSDataClient({ region })
const sm = new SecretsManagerClient({ region })

/** Run one SQL statement as the master user (no bound parameters). */
async function exec(sql) {
  await rds.send(
    new ExecuteStatementCommand({
      resourceArn: AURORA_CLUSTER_ARN,
      secretArn: AURORA_SECRET_ARN, // master (apexadmin)
      database,
      sql,
    }),
  )
}

/** Run a statement and return its first scalar value. */
async function scalar(sql) {
  const out = await rds.send(
    new ExecuteStatementCommand({ resourceArn: AURORA_CLUSTER_ARN, secretArn: AURORA_SECRET_ARN, database, sql }),
  )
  const field = out.records?.[0]?.[0]
  return field?.stringValue ?? null
}

/** A Postgres identifier we control must still be validated before DDL interpolation. */
function assertIdent(name, label) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe ${label}: "${name}". Expected a simple lower_snake identifier.`)
  }
  return name
}

/** Escape a single-quoted SQL string literal (defensive; the secret excludes quotes/backslash). */
function quote(literal) {
  return `'${String(literal).replace(/'/g, "''")}'`
}

async function run() {
  // 1. Read the app_user credentials from Secrets Manager.
  const res = await sm.send(new GetSecretValueCommand({ SecretId: APP_USER_SECRET_ARN }))
  if (!res.SecretString) throw new Error("app_user secret has no SecretString")
  const { username, password } = JSON.parse(res.SecretString)
  if (!username || !password) throw new Error("app_user secret must contain username and password")
  const role = assertIdent(username, "app_user username")

  // 2. Discover the owner role we are connected as (for ALTER DEFAULT PRIVILEGES).
  const owner = assertIdent((await scalar("SELECT current_user")) ?? "apexadmin", "owner role")

  console.log(`→ provisioning role "${role}" (owner="${owner}", db="${database}", ${region})`)

  // 3. Create the role if it does not exist, then (re)set its login password.
  await exec(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quote(role)}) THEN
         CREATE ROLE ${role} LOGIN;
       END IF;
     END $$;`,
  )
  await exec(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${quote(password)}`)
  console.log("  • role exists + password set")

  // 4. Connect + schema usage. No CREATE on schema (PG16 already strips it from
  //    PUBLIC, but we are explicit) so app_user cannot create objects.
  await exec(`GRANT CONNECT ON DATABASE ${database} TO ${role}`)
  await exec(`GRANT USAGE ON SCHEMA public TO ${role}`)
  await exec(`REVOKE CREATE ON SCHEMA public FROM ${role}`)
  console.log("  • connect + schema usage granted (no CREATE)")

  // 5. DML on every existing table, and USAGE on sequences (needed for the
  //    BIGSERIAL audit_log.id inserts). No TRUNCATE, no REFERENCES, no DDL.
  await exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`)
  await exec(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`)
  console.log("  • DML on existing tables + sequence usage granted")

  // 6. Default privileges so tables/sequences CREATED LATER by the owner (the
  //    next migration) are automatically usable by app_user — otherwise a new
  //    table would be invisible and the app would start erroring.
  await exec(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
  )
  await exec(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
  )
  console.log("  • default privileges set for future tables/sequences")

  console.log(`\n✓ app_user provisioned. Point Vercel's AURORA_SECRET_ARN at the app_user secret and redeploy.`)
}

run().catch((err) => {
  console.error("\ncreate-app-user failed:", err)
  process.exit(1)
})
