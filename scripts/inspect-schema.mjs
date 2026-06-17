/**
 * inspect-schema.mjs — READ-ONLY live Aurora schema introspection + full cross-check.
 *
 * Connects to Aurora via the RDS Data API and reads ONLY catalog views
 * (information_schema / pg_catalog). It performs NO writes and NO DDL.
 *
 * It cross-references the LIVE schema against the expectations baked into
 * scripts/sql/001_schema.sql — covering, for every table:
 *   - column data types + nullability + defaults
 *   - primary keys
 *   - UNIQUE constraints
 *   - FOREIGN KEYS + ON DELETE rules (CASCADE / SET NULL / NO ACTION)
 *   - CHECK constraints (the migration-significant ones)
 *   - enum types + values
 *   - indexes
 *
 * Prints a ✓/✗ per item and an overall verdict. Exit code 0 = MATCH.
 *
 * Usage:
 *   AURORA_CLUSTER_ARN=... AURORA_SECRET_ARN=... AURORA_DATABASE=apex \
 *   AWS_REGION=eu-west-2 node scripts/inspect-schema.mjs
 */
import { RDSDataClient, ExecuteStatementCommand } from "@aws-sdk/client-rds-data"

const { AURORA_CLUSTER_ARN, AURORA_SECRET_ARN } = process.env
const database = process.env.AURORA_DATABASE ?? "apex"
const region = process.env.AWS_REGION ?? "eu-west-2"

if (!AURORA_CLUSTER_ARN || !AURORA_SECRET_ARN) {
  console.error("Missing AURORA_CLUSTER_ARN / AURORA_SECRET_ARN. Set env vars first.")
  process.exit(1)
}

const client = new RDSDataClient({ region })

async function q(sql) {
  const res = await client.send(
    new ExecuteStatementCommand({
      resourceArn: AURORA_CLUSTER_ARN,
      secretArn: AURORA_SECRET_ARN,
      database,
      sql,
      includeResultMetadata: true,
    }),
  )
  const cols = (res.columnMetadata ?? []).map((c) => c.label ?? c.name)
  return (res.records ?? []).map((row) => {
    const o = {}
    row.forEach((f, i) => {
      o[cols[i]] =
        f.isNull ? null
        : f.stringValue ?? f.longValue ?? (f.booleanValue !== undefined ? f.booleanValue : f.doubleValue ?? null)
    })
    return o
  })
}

// ============================================================================
// EXPECTATIONS — transcribed from scripts/sql/001_schema.sql
// Column spec: [name, type, notNull, defaultContains|null]
//   type ∈ text|boolean|timestamptz|jsonb|int|numeric|bigint|enum:<name>
// ============================================================================
const TX = "timestamptz", T = "text", B = "boolean", J = "jsonb", I = "int", N = "numeric", BIG = "bigint"

const EXPECTED = {
  parents: {
    columns: [
      ["id", T, true, null],
      ["email", T, true, null],
      ["guardian_attested", B, true, "false"],
      ["age_attested", B, true, "false"],
      ["stripe_customer_id", T, false, null],
      ["has_used_trial", B, true, "false"],
      ["created_at", TX, true, "now()"],
      ["deleted_at", TX, false, null],
    ],
    pk: ["id"],
    unique: [["stripe_customer_id"]],
    fks: [],
  },
  subscriptions: {
    columns: [
      ["id", T, true, "gen_random_uuid"],
      ["parent_id", T, true, null],
      ["stripe_subscription_id", T, false, null],
      ["status", "enum:subscription_status", true, "incomplete"],
      ["price_id", T, false, null],
      ["current_period_end", TX, false, null],
      ["trial_end", TX, false, null],
      ["cancel_at_period_end", B, true, "false"],
      ["status_event_at", TX, false, null],
      ["created_at", TX, true, "now()"],
      ["updated_at", TX, true, "now()"],
    ],
    pk: ["id"],
    unique: [["stripe_subscription_id"], ["parent_id"]],
    fks: [["parent_id", "parents", "id", "CASCADE"]],
  },
  children: {
    columns: [
      ["id", T, true, "gen_random_uuid"],
      ["parent_id", T, true, null],
      ["display_name", T, true, null],
      ["year_group", I, false, null],
      ["avatar_color", T, true, "teal"],
      ["created_at", TX, true, "now()"],
      ["deleted_at", TX, false, null],
    ],
    pk: ["id"],
    unique: [],
    fks: [["parent_id", "parents", "id", "CASCADE"]],
    checks: [/year_group.*4.*6|year_group >= 4/i],
  },
  questions: {
    columns: [
      ["id", T, true, null],
      ["text", T, true, null],
      ["options", J, true, null],
      ["correct_index", I, true, null],
      ["topic", "enum:topic", true, null],
      ["difficulty", I, true, null],
      ["image_url", T, false, null],
      ["image_description", T, false, null],
      ["active", B, true, "true"],
      ["created_at", TX, true, "now()"],
    ],
    pk: ["id"],
    unique: [],
    fks: [],
  },
  sessions: {
    columns: [
      ["id", T, true, "gen_random_uuid"],
      ["child_id", T, true, null],
      ["parent_id", T, true, null],
      ["type", "enum:session_type", true, null],
      ["topic", "enum:topic", false, null],
      ["question_ids", J, true, null],
      ["status", "enum:session_status", true, "active"],
      ["started_at", TX, true, "now()"],
      ["expires_at", TX, true, null],
      ["completed_at", TX, false, null],
      ["time_limit_seconds", I, true, null],
      ["help_used", I, true, "0"],
      ["score", I, false, null],
      ["total", I, true, null],
    ],
    pk: ["id"],
    unique: [],
    fks: [
      ["child_id", "children", "id", "CASCADE"],
      ["parent_id", "parents", "id", "CASCADE"],
    ],
  },
  session_answers: {
    columns: [
      ["id", T, true, "gen_random_uuid"],
      ["session_id", T, true, null],
      ["question_id", T, true, null],
      ["position", I, true, null],
      ["selected_index", I, false, null],
      ["is_correct", B, false, null],
      ["topic", "enum:topic", true, null],
      ["answered_at", TX, false, null],
    ],
    pk: ["id"],
    unique: [["session_id", "position"]],
    fks: [
      ["session_id", "sessions", "id", "CASCADE"],
      ["question_id", "questions", "id", "NO ACTION"],
    ],
  },
  progress: {
    columns: [
      ["id", T, true, "gen_random_uuid"],
      ["child_id", T, true, null],
      ["topic", "enum:topic", true, null],
      ["attempts", I, true, "0"],
      ["correct", I, true, "0"],
      ["mastery_score", N, true, "0"],
      ["classification", "enum:mastery_classification", true, "needs_focus"],
      ["updated_at", TX, true, "now()"],
    ],
    pk: ["id"],
    unique: [["child_id", "topic"]],
    fks: [["child_id", "children", "id", "CASCADE"]],
  },
  review_reports: {
    columns: [
      ["id", T, true, "gen_random_uuid"],
      ["session_id", T, true, null],
      ["summary", J, true, null],
      ["generated_by", T, true, "nova"],
      ["created_at", TX, true, "now()"],
    ],
    pk: ["id"],
    unique: [["session_id"]],
    fks: [["session_id", "sessions", "id", "CASCADE"]],
  },
  audit_log: {
    columns: [
      ["id", BIG, true, "nextval"],
      ["parent_id", T, false, null],
      ["child_id", T, false, null],
      ["action", T, true, null],
      ["detail", J, false, null],
      ["created_at", TX, true, "now()"],
    ],
    pk: ["id"],
    unique: [],
    fks: [],
  },
  processed_webhook_events: {
    columns: [
      ["event_id", T, true, null],
      ["type", T, true, null],
      ["processed_at", TX, true, "now()"],
    ],
    pk: ["event_id"],
    unique: [],
    fks: [],
  },
  revenue_events: {
    columns: [
      ["id", T, true, "gen_random_uuid"],
      ["parent_id", T, false, null],
      ["stripe_invoice_id", T, false, null],
      ["amount_pence", I, true, null],
      ["currency", T, true, "gbp"],
      ["occurred_at", TX, true, "now()"],
    ],
    pk: ["id"],
    unique: [["stripe_invoice_id"]],
    fks: [["parent_id", "parents", "id", "SET NULL"]],
  },
  revenue_summary: {
    columns: [
      ["id", T, true, "current"],
      ["total_revenue_pence", BIG, true, "0"],
      ["paying_parent_count", I, true, "0"],
      ["first_paid_at", TX, false, null],
      ["updated_at", TX, true, "now()"],
    ],
    pk: ["id"],
    unique: [],
    fks: [],
  },
}

const EXPECTED_ENUMS = {
  topic: ["number", "fractions_decimals_percentages", "ratio_proportion", "algebra", "geometry", "data_handling"],
  session_type: ["warmup", "topic", "mock"],
  session_status: ["active", "completed", "expired", "abandoned"],
  subscription_status: ["trialing", "active", "past_due", "canceled", "incomplete", "unpaid"],
  mastery_classification: ["needs_focus", "developing", "strong", "insufficient_data"],
}

const EXPECTED_INDEXES = [
  "idx_subscriptions_parent", "idx_children_parent", "idx_questions_topic",
  "idx_sessions_child", "idx_sessions_parent", "uniq_active_session_per_child",
  "idx_answers_session", "idx_audit_parent", "idx_audit_created",
]

// ---- type matcher: expected token vs (data_type, udt_name) ----
function typeMatches(expected, dataType, udt) {
  if (expected.startsWith("enum:")) return dataType === "USER-DEFINED" && udt === expected.slice(5)
  const map = {
    text: "text", boolean: "boolean", timestamptz: "timestamp with time zone",
    jsonb: "jsonb", int: "integer", numeric: "numeric", bigint: "bigint",
  }
  return dataType === map[expected]
}

// ---- reporting ----
let pass = 0, fail = 0
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++ }
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++ }

async function run() {
  console.log(`\nFull cross-check of live Aurora schema vs scripts/sql/001_schema.sql  (db="${database}", ${region})`)

  // ---------- ENUMS ----------
  console.log("\n── ENUM TYPES ──")
  const enumRows = await q(`
    SELECT t.typname AS enum_name, e.enumlabel AS value
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname='public' ORDER BY t.typname, e.enumsortorder`)
  const liveEnums = {}
  for (const r of enumRows) (liveEnums[r.enum_name] ??= []).push(r.value)
  for (const [name, vals] of Object.entries(EXPECTED_ENUMS)) {
    const live = liveEnums[name]
    if (!live) { bad(`enum ${name} MISSING`); continue }
    const missing = vals.filter((v) => !live.includes(v))
    const extra = live.filter((v) => !vals.includes(v))
    if (!missing.length && !extra.length) ok(`enum ${name} (${vals.length} values)`)
    else bad(`enum ${name} differs — missing:[${missing}] extra:[${extra}]`)
  }

  // ---------- COLUMNS: type, nullability, default ----------
  console.log("\n── COLUMNS (type / nullability / default) ──")
  const colRows = await q(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, ordinal_position
    FROM information_schema.columns WHERE table_schema='public'
    ORDER BY table_name, ordinal_position`)
  const liveCols = {}
  for (const r of colRows) {
    (liveCols[r.table_name] ??= {})[r.column_name] = r
  }
  for (const [table, spec] of Object.entries(EXPECTED)) {
    const live = liveCols[table]
    if (!live) { bad(`table ${table} MISSING`); continue }
    const expectedNames = spec.columns.map((c) => c[0])
    const extra = Object.keys(live).filter((c) => !expectedNames.includes(c))
    let tableOk = true
    for (const [name, type, notNull, defContains] of spec.columns) {
      const c = live[name]
      if (!c) { bad(`${table}.${name} MISSING`); tableOk = false; continue }
      const problems = []
      if (!typeMatches(type, c.data_type, c.udt_name))
        problems.push(`type=${c.data_type}${c.data_type === "USER-DEFINED" ? `(${c.udt_name})` : ""} expected ${type}`)
      const liveNotNull = c.is_nullable === "NO"
      if (liveNotNull !== notNull) problems.push(`nullable=${c.is_nullable} expected ${notNull ? "NO" : "YES"}`)
      if (defContains) {
        const d = String(c.column_default ?? "")
        if (!d.toLowerCase().includes(defContains.toLowerCase()))
          problems.push(`default="${c.column_default}" expected to contain "${defContains}"`)
      }
      if (problems.length) { bad(`${table}.${name} — ${problems.join("; ")}`); tableOk = false }
    }
    if (extra.length) { bad(`${table} has EXTRA columns not in 001_schema.sql: ${extra.join(", ")}`); tableOk = false }
    if (tableOk) ok(`${table} — all ${spec.columns.length} columns match (type/null/default)`)
  }
  for (const t of Object.keys(liveCols)) {
    if (!EXPECTED[t]) bad(`table ${t} EXTRA in live DB (not in 001_schema.sql)`)
  }

  // ---------- PRIMARY KEYS + UNIQUE ----------
  console.log("\n── PRIMARY KEYS & UNIQUE CONSTRAINTS ──")
  const conRows = await q(`
    SELECT tc.table_name, tc.constraint_type, kcu.column_name, kcu.ordinal_position, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
    WHERE tc.table_schema='public' AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
    ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`)
  // group into { table: { pk: [...], uniques: [[...],[...]] } }
  const grouped = {}
  const byConstraint = {}
  for (const r of conRows) {
    (byConstraint[r.constraint_name] ??= { table: r.table_name, type: r.constraint_type, cols: [] }).cols.push(r.column_name)
  }
  for (const cn of Object.values(byConstraint)) {
    const g = (grouped[cn.table] ??= { pk: null, uniques: [] })
    if (cn.type === "PRIMARY KEY") g.pk = cn.cols
    else g.uniques.push(cn.cols)
  }
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
  for (const [table, spec] of Object.entries(EXPECTED)) {
    const g = grouped[table] ?? { pk: null, uniques: [] }
    // PK
    if (g.pk && sameSet(g.pk, spec.pk)) ok(`${table} PK (${spec.pk.join(",")})`)
    else bad(`${table} PK mismatch — live:[${g.pk}] expected:[${spec.pk}]`)
    // UNIQUE
    for (const u of spec.unique) {
      if (g.uniques.some((lu) => sameSet(lu, u))) ok(`${table} UNIQUE (${u.join(",")})`)
      else bad(`${table} UNIQUE (${u.join(",")}) MISSING`)
    }
    // extra uniques (informational, counts as mismatch to be safe)
    for (const lu of g.uniques) {
      if (!spec.unique.some((u) => sameSet(lu, u)))
        bad(`${table} has EXTRA UNIQUE (${lu.join(",")}) not in 001_schema.sql`)
    }
  }

  // ---------- FOREIGN KEYS + ON DELETE ----------
  console.log("\n── FOREIGN KEYS & ON DELETE RULES ──")
  const fkRows = await q(`
    SELECT tc.table_name AS src_table, kcu.column_name AS src_col,
           ccu.table_name AS ref_table, ccu.column_name AS ref_col, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
    WHERE tc.table_schema='public' AND tc.constraint_type='FOREIGN KEY'
    ORDER BY tc.table_name, kcu.column_name`)
  const liveFks = fkRows.map((r) => ({
    src: `${r.src_table}.${r.src_col}`, ref: `${r.ref_table}.${r.ref_col}`, rule: r.delete_rule,
  }))
  const expectedFkCount = Object.values(EXPECTED).reduce((s, t) => s + t.fks.length, 0)
  for (const [table, spec] of Object.entries(EXPECTED)) {
    for (const [col, refTable, refCol, rule] of spec.fks) {
      const m = liveFks.find((f) => f.src === `${table}.${col}` && f.ref === `${refTable}.${refCol}`)
      if (!m) bad(`FK ${table}.${col} → ${refTable}.${refCol} MISSING`)
      else if (m.rule !== rule) bad(`FK ${table}.${col} → ${refTable}.${refCol} ON DELETE ${m.rule} (expected ${rule})`)
      else ok(`FK ${table}.${col} → ${refTable}.${refCol} ON DELETE ${rule}`)
    }
  }
  // any extra FK in the live DB?
  const expectedFkKeys = new Set(
    Object.entries(EXPECTED).flatMap(([t, s]) => s.fks.map(([c, rt, rc]) => `${t}.${c}->${rt}.${rc}`)),
  )
  for (const f of liveFks) {
    const key = `${f.src}->${f.ref}`
    if (!expectedFkKeys.has(key)) bad(`EXTRA FK in live DB: ${f.src} → ${f.ref} (ON DELETE ${f.rule})`)
  }
  console.log(`  (live FKs: ${liveFks.length}, expected: ${expectedFkCount})`)

  // ---------- CHECK constraints (significant ones) ----------
  console.log("\n── CHECK CONSTRAINTS (spot checks) ──")
  const checkRows = await q(`
    SELECT t.relname AS table_name, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname='public' AND c.contype='c' ORDER BY t.relname`)
  for (const [table, spec] of Object.entries(EXPECTED)) {
    if (!spec.checks) continue
    const defs = checkRows.filter((r) => r.table_name === table).map((r) => r.def)
    for (const re of spec.checks) {
      if (defs.some((d) => re.test(d))) ok(`${table} CHECK ${re} satisfied`)
      else bad(`${table} CHECK ${re} NOT found (live: ${defs.join(" | ") || "none"})`)
    }
  }

  // ---------- INDEXES ----------
  console.log("\n── INDEXES ──")
  const idxRows = await q(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)
  const liveIdx = idxRows.map((r) => r.indexname)
  for (const ix of EXPECTED_INDEXES) {
    if (liveIdx.includes(ix)) ok(`index ${ix}`)
    else bad(`index ${ix} MISSING`)
  }

  // ---------- VERDICT ----------
  console.log("\n" + "=".repeat(64))
  if (fail === 0)
    console.log(`\x1b[32mVERDICT: FULL MATCH\x1b[0m — live schema == scripts/sql/001_schema.sql (${pass} checks passed)`)
  else
    console.log(`\x1b[31mVERDICT: MISMATCH\x1b[0m — ${fail} difference(s), ${pass} passed. See ✗ above.`)
  console.log("=".repeat(64) + "\n")
  process.exit(fail === 0 ? 0 : 1)
}

run().catch((err) => {
  console.error("\nInspection failed:", err)
  process.exit(2)
})
