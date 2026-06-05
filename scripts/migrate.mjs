/**
 * Apply the schema to Aurora and seed the question bank, via the RDS Data API.
 *
 * Steps:
 *   1. Run every scripts/sql/*.sql file in order (schema, enums, indexes).
 *   2. Seed questions from data/questions.json (idempotent upsert by id).
 *      - imageUrl "figures/<id>.png" is normalised to the web path
 *        "/figures/<id>.png" (served from public/figures via Vercel's CDN).
 *      - imageDescription is stored server-side only (never sent to the client;
 *        used to describe the figure to the LLM without sending the image).
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
const repoRoot = join(__dirname, "..")
const sqlDir = join(__dirname, "sql")
const questionsFile = join(repoRoot, "data", "questions.json")

const { AURORA_CLUSTER_ARN, AURORA_SECRET_ARN } = process.env
const database = process.env.AURORA_DATABASE ?? "apex"
const region = process.env.AWS_REGION ?? "eu-west-2"

if (!AURORA_CLUSTER_ARN || !AURORA_SECRET_ARN) {
  console.error("Missing AURORA_CLUSTER_ARN / AURORA_SECRET_ARN. Set env vars first.")
  process.exit(1)
}

const client = new RDSDataClient({ region })

const TOPICS = new Set([
  "number",
  "fractions_decimals_percentages",
  "ratio_proportion",
  "algebra",
  "geometry",
  "data_handling",
])

/** Run one SQL statement (no parameters). */
async function exec(sql) {
  await client.send(
    new ExecuteStatementCommand({ resourceArn: AURORA_CLUSTER_ARN, secretArn: AURORA_SECRET_ARN, database, sql }),
  )
}

/** Run a parameterised SQL statement (safe binding — no string interpolation). */
async function execParams(sql, parameters) {
  await client.send(
    new ExecuteStatementCommand({
      resourceArn: AURORA_CLUSTER_ARN,
      secretArn: AURORA_SECRET_ARN,
      database,
      sql,
      parameters,
    }),
  )
}

/** Split SQL into statements, respecting $$ dollar-quoted blocks, ' strings, and -- line comments. */
function splitSql(sql) {
  const statements = []
  let current = ""
  let inSingle = false
  let inDollar = false
  let inLineComment = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const two = sql.slice(i, i + 2)

    // End a line comment at newline.
    if (inLineComment) {
      current += ch
      if (ch === "\n") inLineComment = false
      continue
    }

    // Start of a -- line comment (only outside strings/dollar blocks).
    if (!inSingle && !inDollar && two === "--") {
      inLineComment = true
      current += two
      i++
      continue
    }

    // Toggle $$ dollar-quoted blocks (only outside single quotes).
    if (!inSingle && two === "$$") {
      inDollar = !inDollar
      current += two
      i++
      continue
    }

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

async function applySchema() {
  const files = readdirSync(sqlDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  for (const file of files) {
    const sql = readFileSync(join(sqlDir, file), "utf8")
    const statements = splitSql(sql)
    console.log(`\n→ ${file} (${statements.length} statements)`)
    for (const statement of statements) {
      await exec(statement)
      process.stdout.write(".")
    }
    console.log(" done")
  }
}

/** Normalise a dataset imageUrl ("figures/<id>.png") to a web path ("/figures/<id>.png"). */
function toWebImageUrl(imageUrl) {
  if (!imageUrl) return null
  let p = String(imageUrl).trim()
  if (!p) return null
  p = p.replace(/^\.?\//, "") // strip leading "./" or "/"
  if (p.startsWith("data/")) p = p.slice("data/".length)
  if (!p.startsWith("figures/")) p = `figures/${p.replace(/^figures\//, "")}`
  return `/${p}`
}

function validateQuestion(q, idx) {
  const where = `questions[${idx}] (id=${q?.id ?? "?"})`
  if (!q.id || typeof q.id !== "string") throw new Error(`${where}: missing string id`)
  if (!q.text || typeof q.text !== "string") throw new Error(`${where}: missing text`)
  if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`${where}: needs >=2 options`)
  if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length)
    throw new Error(`${where}: correctIndex out of range`)
  if (!TOPICS.has(q.topic)) throw new Error(`${where}: invalid topic "${q.topic}"`)
  if (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 5)
    throw new Error(`${where}: difficulty must be 1-5`)
}

async function seedQuestions() {
  const raw = readFileSync(questionsFile, "utf8")
  const questions = JSON.parse(raw)
  if (!Array.isArray(questions)) throw new Error("data/questions.json must be an array")

  console.log(`\n→ seeding ${questions.length} questions from data/questions.json`)

  // Idempotent upsert keyed by the stable string id. Re-running updates content
  // in place and never duplicates. correct_index/image_description stay server-side.
  const sql = `
    INSERT INTO questions (id, text, options, correct_index, topic, difficulty, image_url, image_description, active)
    VALUES (:id, :text, :options::jsonb, :correct_index, :topic::topic, :difficulty, :image_url, :image_description, TRUE)
    ON CONFLICT (id) DO UPDATE SET
      text = EXCLUDED.text,
      options = EXCLUDED.options,
      correct_index = EXCLUDED.correct_index,
      topic = EXCLUDED.topic,
      difficulty = EXCLUDED.difficulty,
      image_url = EXCLUDED.image_url,
      image_description = EXCLUDED.image_description,
      active = TRUE`

  let withFigure = 0
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    validateQuestion(q, i)
    const imageUrl = toWebImageUrl(q.imageUrl)
    if (imageUrl) withFigure++

    const parameters = [
      { name: "id", value: { stringValue: q.id } },
      { name: "text", value: { stringValue: q.text } },
      { name: "options", value: { stringValue: JSON.stringify(q.options) } },
      { name: "correct_index", value: { longValue: q.correctIndex } },
      { name: "topic", value: { stringValue: q.topic } },
      { name: "difficulty", value: { longValue: q.difficulty } },
      imageUrl
        ? { name: "image_url", value: { stringValue: imageUrl } }
        : { name: "image_url", value: { isNull: true } },
      q.imageDescription
        ? { name: "image_description", value: { stringValue: q.imageDescription } }
        : { name: "image_description", value: { isNull: true } },
    ]
    await execParams(sql, parameters)
    process.stdout.write(".")
  }
  console.log(`\n  seeded ${questions.length} questions (${withFigure} with figures) done`)
}

async function run() {
  await applySchema()
  await seedQuestions()
  console.log("\nMigrations + seed applied successfully.")
}

run().catch((err) => {
  console.error("\nMigration failed:", err)
  process.exit(1)
})
