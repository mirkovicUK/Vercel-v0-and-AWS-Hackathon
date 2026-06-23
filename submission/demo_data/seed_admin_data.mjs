/**
 * seed_admin_data.mjs — Seed revenue events + contact messages (and the
 * supporting demo customer accounts) so the /admin dashboard looks like a real,
 * running business for the submission video.
 *
 * Creates:
 *   - A handful of demo "customer" parents (id prefix "demo-") with varied
 *     subscription states (active / trialing / past_due / canceled).
 *   - revenue_events for the paying ones (+ one unattributed invoice), then a
 *     recomputed revenue_summary singleton.
 *   - contact_messages from a realistic mix: active subscriber, trialing parent,
 *     past-due parent, the real demo parent, and two logged-out visitors.
 *
 * All seeded rows are TAGGED so the seeder is idempotent and fully removable:
 *   - demo parents:   parents.id LIKE 'demo-%'   (cascades their subscriptions)
 *   - demo invoices:  revenue_events.stripe_invoice_id LIKE 'demo-inv-%'
 *   - demo messages:  contact_messages.source_ip = 'demo-seed'
 *
 * Usage:
 *   node seed_admin_data.mjs           # wipe demo-tagged rows, reseed, verify
 *   node seed_admin_data.mjs --wipe    # remove demo-tagged rows only
 *   node seed_admin_data.mjs --verify  # print admin-relevant summary
 */
import { RDSDataClient, ExecuteStatementCommand } from "@aws-sdk/client-rds-data"

const REGION = process.env.AWS_REGION ?? "eu-west-2"
const DATABASE = process.env.AURORA_DATABASE ?? "apex"
// ARNs come from the environment only — no hardcoded account ids/ARNs in the
// repo (same convention as scripts/migrate.mjs and scripts/inspect-schema.mjs).
const CLUSTER_ARN = process.env.AURORA_CLUSTER_ARN
const SECRET_ARN = process.env.AURORA_SECRET_ARN
if (!CLUSTER_ARN || !SECRET_ARN) {
  console.error("Missing AURORA_CLUSTER_ARN / AURORA_SECRET_ARN. Set them first (see README).")
  process.exit(1)
}

const client = new RDSDataClient({ region: REGION })

// The real demo parent (so one contact message comes from the account on screen).
const REAL_PARENT_ID = "d68272f4-d061-70a6-0186-c5ee1aa779cc"
const REAL_PARENT_EMAIL = "uros1311@gmail.com"

const PRICE_PENCE = 1999 // £19.99

async function exec(sql, parameters = []) {
  const res = await client.send(
    new ExecuteStatementCommand({
      resourceArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
      database: DATABASE,
      sql,
      parameters,
      includeResultMetadata: true,
    }),
  )
  const cols = (res.columnMetadata ?? []).map((c) => c.label ?? c.name)
  return (res.records ?? []).map((row) => {
    const o = {}
    row.forEach((f, i) => {
      o[cols[i]] = f.isNull
        ? null
        : f.stringValue ?? f.longValue ?? (f.booleanValue !== undefined ? f.booleanValue : f.doubleValue ?? null)
    })
    return o
  })
}

const pStr = (name, v) => ({ name, value: v == null ? { isNull: true } : { stringValue: String(v) } })
const pInt = (name, v) => ({ name, value: v == null ? { isNull: true } : { longValue: v } })

// ---------------------------------------------------------------------------
// Demo customers (subscription state drives the contact inbox sender context).
// ageDays = how long ago the account was created (some within 30d so the
// "new parents (30d)" metric is non-zero).
// ---------------------------------------------------------------------------
const CUSTOMERS = [
  { id: "demo-p1", name: "Priya Shah", email: "priya.shah@example.com", sub: "active", ageDays: 95, invoices: 3 },
  { id: "demo-p2", name: "Tom Whitfield", email: "tom.whitfield@example.com", sub: "active", ageDays: 64, invoices: 2 },
  { id: "demo-p3", name: "Sarah Lin", email: "sarah.lin@example.com", sub: "active", ageDays: 130, invoices: 4 },
  { id: "demo-p4", name: "James O'Connor", email: "james.oconnor@example.com", sub: "trialing", ageDays: 4, invoices: 0 },
  { id: "demo-p5", name: "Aisha Khan", email: "aisha.khan@example.com", sub: "past_due", ageDays: 38, invoices: 1 },
  { id: "demo-p6", name: "Mark Davies", email: "mark.davies@example.com", sub: "canceled", ageDays: 160, invoices: 2 },
]

// Contact messages — varied senders for rich sender-context triage.
const MESSAGES = [
  { pid: "demo-p4", name: "James O'Connor", email: "james.oconnor@example.com", hoursAgo: 3, status: "new",
    message: "Hi — we're on the free trial and my son loves it. Will his progress and history carry over if we subscribe before the trial ends?" },
  { pid: "demo-p1", name: "Priya Shah", email: "priya.shah@example.com", hoursAgo: 20, status: "seen",
    message: "Is there any way to add a fourth child profile? We have three using it already and a younger one starting next year." },
  { pid: null, name: "Margaret Allen", email: "m.allen@example.com", hoursAgo: 28, status: "new",
    message: "Do your practice papers follow the GL or the CEM style of the 11+? Our target grammar school uses GL. Thank you." },
  { pid: "demo-p5", name: "Aisha Khan", email: "aisha.khan@example.com", hoursAgo: 41, status: "new",
    message: "My monthly payment seems to have failed and I've lost access. How do I update my card details so my daughter can keep practising?" },
  { pid: null, name: "St. Mary's Prep (Head of Maths)", email: "maths@stmarysprep.example.com", hoursAgo: 73, status: "new",
    message: "We're a prep school preparing pupils for the 11+. Do you offer school or classroom licences for a group of around 40 students?" },
  { pid: REAL_PARENT_ID, name: "Uros", email: REAL_PARENT_EMAIL, hoursAgo: 9, status: "new",
    message: "Really impressed with the progress dashboard and the Skill Builder. Any plans to add English comprehension papers alongside maths?" },
]

// ---------------------------------------------------------------------------
// Wipe (demo-tagged only)
// ---------------------------------------------------------------------------
async function wipe() {
  await exec(`DELETE FROM contact_messages WHERE source_ip = 'demo-seed'`)
  await exec(`DELETE FROM revenue_events WHERE stripe_invoice_id LIKE 'demo-inv-%'`)
  await exec(`DELETE FROM parents WHERE id LIKE 'demo-%'`) // cascades demo subscriptions
  await recomputeRevenueSummary()
}

async function recomputeRevenueSummary() {
  await exec(
    `INSERT INTO revenue_summary (id, total_revenue_pence, paying_parent_count, first_paid_at, updated_at)
     SELECT 'current',
            COALESCE(SUM(amount_pence), 0),
            COUNT(DISTINCT parent_id) FILTER (WHERE parent_id IS NOT NULL),
            MIN(occurred_at),
            now()
     FROM revenue_events
     ON CONFLICT (id) DO UPDATE SET
       total_revenue_pence = EXCLUDED.total_revenue_pence,
       paying_parent_count = EXCLUDED.paying_parent_count,
       first_paid_at       = EXCLUDED.first_paid_at,
       updated_at          = now()`,
  )
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
function subSql(customer) {
  // Period/trial windows expressed relative to now() so they're always sensible
  // when the admin dashboard is viewed. Integers are code-controlled (safe).
  const base = `INSERT INTO subscriptions
    (parent_id, stripe_subscription_id, status, price_id, current_period_end, trial_end, cancel_at_period_end, status_event_at, created_at, updated_at)
    VALUES (:pid, :subId, :status::subscription_status, NULL, %CPE%, %TRIAL%, :cancelEnd, now(), now() - make_interval(days => :ageDays::int), now())
    ON CONFLICT (parent_id) DO UPDATE SET
      status = EXCLUDED.status, current_period_end = EXCLUDED.current_period_end,
      trial_end = EXCLUDED.trial_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      status_event_at = now(), updated_at = now()`
  let cpe = "NULL"
  let trial = "NULL"
  let cancelEnd = false
  switch (customer.sub) {
    case "active":
      cpe = "now() + interval '18 days'"
      break
    case "trialing":
      cpe = "now() + interval '2 days'"
      trial = "now() + interval '2 days'" // ends soon -> shows in "trials ending soon"
      break
    case "past_due":
      cpe = "now() - interval '3 days'"
      break
    case "canceled":
      cpe = "now() - interval '20 days'"
      cancelEnd = true
      break
  }
  return { sql: base.replace("%CPE%", cpe).replace("%TRIAL%", trial), cancelEnd }
}

async function seed() {
  console.log("Seeding demo customers, subscriptions, revenue, and contact messages ...")

  for (const c of CUSTOMERS) {
    // Parent
    await exec(
      `INSERT INTO parents (id, email, guardian_attested, age_attested, has_used_trial, created_at)
       VALUES (:id, :email, TRUE, TRUE, :usedTrial, now() - make_interval(days => :ageDays::int))
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [
        pStr("id", c.id),
        pStr("email", c.email),
        { name: "usedTrial", value: { booleanValue: c.sub !== "trialing" } },
        pInt("ageDays", c.ageDays),
      ],
    )
    // Subscription
    const { sql, cancelEnd } = subSql(c)
    await exec(sql, [
      pStr("pid", c.id),
      pStr("subId", `demo-sub-${c.id}`),
      pStr("status", c.sub),
      { name: "cancelEnd", value: { booleanValue: cancelEnd } },
      pInt("ageDays", c.ageDays),
    ])
    // Revenue events (monthly-ish, most recent first)
    for (let i = 0; i < c.invoices; i++) {
      const daysAgo = 5 + i * 30
      await exec(
        `INSERT INTO revenue_events (parent_id, stripe_invoice_id, amount_pence, currency, occurred_at)
         VALUES (:pid, :inv, :amt, 'gbp', now() - make_interval(days => :daysAgo::int))
         ON CONFLICT (stripe_invoice_id) DO NOTHING`,
        [pStr("pid", c.id), pStr("inv", `demo-inv-${c.id}-${i + 1}`), pInt("amt", PRICE_PENCE), pInt("daysAgo", daysAgo)],
      )
    }
  }

  // One unattributed invoice (parent_id NULL) — exercises the "unattributed" path.
  await exec(
    `INSERT INTO revenue_events (parent_id, stripe_invoice_id, amount_pence, currency, occurred_at)
     VALUES (NULL, 'demo-inv-unattributed-1', :amt, 'gbp', now() - interval '12 days')
     ON CONFLICT (stripe_invoice_id) DO NOTHING`,
    [pInt("amt", PRICE_PENCE)],
  )

  await recomputeRevenueSummary()

  // Contact messages
  for (const m of MESSAGES) {
    await exec(
      `INSERT INTO contact_messages (parent_id, name, email, message, source_ip, status, created_at)
       VALUES (:pid, :name, :email, :message, 'demo-seed', :status, now() - make_interval(hours => :hoursAgo::int))`,
      [
        pStr("pid", m.pid),
        pStr("name", m.name),
        pStr("email", m.email),
        pStr("message", m.message),
        pStr("status", m.status),
        pInt("hoursAgo", m.hoursAgo),
      ],
    )
  }
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------
async function verify() {
  const summary = await exec(
    `SELECT total_revenue_pence, paying_parent_count, first_paid_at FROM revenue_summary WHERE id='current'`,
  )
  const subs = await exec(`SELECT status, count(*) AS n FROM subscriptions GROUP BY status ORDER BY status`)
  const inv = await exec(`SELECT count(*) AS n FROM revenue_events`)
  const msgs = await exec(`SELECT status, count(*) AS n FROM contact_messages GROUP BY status ORDER BY status`)
  const demoParents = await exec(`SELECT count(*) AS n FROM parents WHERE id LIKE 'demo-%'`)

  console.log("\n── Admin data summary ──")
  if (summary[0]) {
    const r = summary[0]
    console.log(`revenue_summary: £${(Number(r.total_revenue_pence) / 100).toFixed(2)} total, ` +
      `${r.paying_parent_count} paying parents, first_paid_at=${r.first_paid_at}`)
  }
  console.log(`revenue_events: ${inv[0]?.n} rows`)
  console.log(`demo parents: ${demoParents[0]?.n}`)
  console.log("subscriptions by status:", subs.map((s) => `${s.status}=${s.n}`).join("  "))
  console.log("contact_messages by status:", msgs.map((s) => `${s.status}=${s.n}`).join("  "))
}

// ---------------------------------------------------------------------------
async function main() {
  if (process.argv.includes("--verify")) return verify()
  console.log(`Region=${REGION} db=${DATABASE}`)
  console.log("Clearing demo-tagged rows ...")
  await wipe()
  if (process.argv.includes("--wipe")) {
    console.log("Wipe-only complete.")
    return verify()
  }
  await seed()
  console.log("Done.")
  await verify()
}

main().catch((err) => {
  console.error("\nAdmin seed failed:", err)
  process.exit(1)
})
