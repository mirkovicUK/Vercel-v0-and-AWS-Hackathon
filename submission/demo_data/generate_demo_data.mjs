/**
 * generate_demo_data.mjs — Seed rich, realistic practice history for the demo
 * account (uros1311@gmail.com) so the dashboard/analytics are full for the video.
 *
 * Writes across sessions, session_answers, progress, and review_reports for the
 * three existing children (Nina ~85%, Amara ~50%, Lui ~30%) over 1–22 Jun 2026.
 *
 * Scoped + idempotent: clears existing sessions/progress for ONLY these three
 * child IDs, then regenerates deterministically (seeded RNG).
 *
 * Usage:
 *   node generate_demo_data.mjs            # clear + regenerate
 *   node generate_demo_data.mjs --verify   # just print resulting mastery summary
 */
import {
  RDSDataClient,
  ExecuteStatementCommand,
  BatchExecuteStatementCommand,
} from "@aws-sdk/client-rds-data"
import { randomUUID } from "node:crypto"

// ---------------------------------------------------------------------------
// Connection (auto-discovered ARNs for the ApexMaths cluster; override via env)
// ---------------------------------------------------------------------------
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

const PARENT_ID = "d68272f4-d061-70a6-0186-c5ee1aa779cc"

const TOPICS = [
  "number",
  "fractions_decimals_percentages",
  "ratio_proportion",
  "algebra",
  "geometry",
  "data_handling",
]

// Session-type config (mirrors lib/domain.ts).
const TYPE_CONFIG = {
  warmup: { count: 10, limit: 600, mixed: true },
  topic: { count: 5, limit: 600, mixed: false },
  mock: { count: 30, limit: 3000, mixed: true },
  adaptive: { count: 15, limit: 1200, mixed: true },
}

// Children + their mastery profiles. topicOffset shapes strengths/weaknesses;
// drift is the gentle improvement applied across the month.
const CHILDREN = [
  {
    id: "7a30eaa2-fdba-4069-8e52-64bbe5791889",
    name: "Nina",
    year: 6,
    base: 0.85,
    drift: 0.06,
    seed: 1101,
    topicOffset: {
      number: 0.05,
      fractions_decimals_percentages: 0.0,
      ratio_proportion: -0.05,
      algebra: -0.1,
      geometry: 0.08,
      data_handling: 0.02,
    },
  },
  {
    id: "506c640c-5340-4537-850e-fa9681ab073f",
    name: "Amara",
    year: 5,
    base: 0.5,
    drift: 0.05,
    seed: 2202,
    topicOffset: {
      number: 0.08,
      fractions_decimals_percentages: -0.06,
      ratio_proportion: 0.02,
      algebra: -0.1,
      geometry: 0.05,
      data_handling: -0.04,
    },
  },
  {
    id: "4ab8cb02-23fe-47f1-b5ac-ebc9b2423623",
    name: "Lui",
    year: 4,
    base: 0.3,
    drift: 0.05,
    seed: 3303,
    topicOffset: {
      number: 0.1,
      fractions_decimals_percentages: -0.05,
      ratio_proportion: -0.02,
      algebra: -0.08,
      geometry: 0.06,
      data_handling: -0.04,
    },
  },
]

// Date window (inclusive) — 1 Jun 2026 .. 22 Jun 2026.
const START = new Date("2026-06-01T00:00:00Z")
const END = new Date("2026-06-22T00:00:00Z")
const DAY_MS = 86_400_000
const TOTAL_DAYS = Math.round((END - START) / DAY_MS) + 1 // 22 (inclusive 1–22 Jun)

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) so re-runs reproduce the same data.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)]
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const uuid = () => randomUUID()

// ---------------------------------------------------------------------------
// Data API helpers
// ---------------------------------------------------------------------------
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
  const rows = (res.records ?? []).map((row) => {
    const o = {}
    row.forEach((f, i) => {
      o[cols[i]] = f.isNull
        ? null
        : f.stringValue ??
          f.longValue ??
          (f.booleanValue !== undefined ? f.booleanValue : f.doubleValue ?? null)
    })
    return o
  })
  return rows
}

async function batch(sql, parameterSets) {
  if (parameterSets.length === 0) return
  // Chunk to stay well within Data API limits.
  for (let i = 0; i < parameterSets.length; i += 100) {
    const slice = parameterSets.slice(i, i + 100)
    await client.send(
      new BatchExecuteStatementCommand({
        resourceArn: CLUSTER_ARN,
        secretArn: SECRET_ARN,
        database: DATABASE,
        sql,
        parameterSets: slice,
      }),
    )
  }
}

// Parameter builders
const pStr = (name, value) => ({ name, value: value == null ? { isNull: true } : { stringValue: String(value) } })
const pInt = (name, value) => ({ name, value: value == null ? { isNull: true } : { longValue: value } })
const pBool = (name, value) => ({ name, value: value == null ? { isNull: true } : { booleanValue: value } })
const pNum = (name, value) => ({ name, value: value == null ? { isNull: true } : { doubleValue: value } })
const pTs = (name, date) => ({
  name,
  value: date == null ? { isNull: true } : { stringValue: toTs(date) },
  typeHint: "TIMESTAMP",
})
const pJson = (name, obj) => ({ name, value: { stringValue: JSON.stringify(obj) }, typeHint: "JSON" })

function toTs(d) {
  // 'YYYY-MM-DD HH:MM:SS.mmm' (UTC) — matches lib/aws/rds-data.ts convention.
  return d.toISOString().replace("T", " ").replace("Z", "")
}

// ---------------------------------------------------------------------------
// Classification (mirrors lib/domain.ts classifyMastery)
// ---------------------------------------------------------------------------
const MIN_ATTEMPTS = 10
function classify(attempts, scoreFraction) {
  if (attempts < MIN_ATTEMPTS) return "insufficient_data"
  if (scoreFraction >= 0.8) return "strong"
  if (scoreFraction >= 0.5) return "developing"
  return "needs_focus"
}

// Deterministic fallback review text (mirrors lib/ai/review.ts fallbackExplanation).
const TOPIC_LABELS = {
  number: "Number",
  fractions_decimals_percentages: "Fractions, Decimals & Percentages",
  ratio_proportion: "Ratio & Proportion",
  algebra: "Algebra",
  geometry: "Geometry",
  data_handling: "Data Handling",
}
function fallbackItem(questionId, topic) {
  const label = TOPIC_LABELS[topic] ?? "this topic"
  return {
    questionId,
    explanation: `Work back through this ${label} question step by step to see how the correct answer is reached.`,
    nextStep: `Practise a few more ${label} questions, focusing on the method rather than just the final answer.`,
  }
}

// ---------------------------------------------------------------------------
// Load the active question pool
// ---------------------------------------------------------------------------
async function loadQuestionPool() {
  const rows = await exec(
    `SELECT id, topic, difficulty, correct_index,
            jsonb_array_length(options) AS opt_count
     FROM questions WHERE active`,
  )
  const byTopic = Object.fromEntries(TOPICS.map((t) => [t, []]))
  for (const r of rows) {
    byTopic[r.topic]?.push({
      id: r.id,
      topic: r.topic,
      difficulty: Number(r.difficulty),
      correctIndex: Number(r.correct_index),
      optCount: Number(r.opt_count),
    })
  }
  return { all: rows.length, byTopic }
}

// ---------------------------------------------------------------------------
// Wipe (scoped to the three child IDs)
// ---------------------------------------------------------------------------
async function wipe(childIds) {
  const inList = childIds.map((id) => `'${id}'`).join(",")
  // sessions cascade -> session_answers + review_reports
  await exec(`DELETE FROM sessions WHERE child_id IN (${inList})`)
  await exec(`DELETE FROM progress WHERE child_id IN (${inList})`)
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------
function chooseType(rng) {
  const r = rng()
  if (r < 0.5) return "topic"
  if (r < 0.75) return "warmup"
  if (r < 0.9) return "adaptive"
  return "mock"
}

function sessionsForDay(rng) {
  const r = rng()
  if (r < 0.12) return 0
  if (r < 0.68) return 1
  if (r < 0.94) return 2
  return 3
}

async function generateForChild(child, pool) {
  const rng = mulberry32(child.seed)
  // Per-child accumulators for the progress rollup.
  const agg = Object.fromEntries(TOPICS.map((t) => [t, { attempts: 0, correct: 0 }]))

  const sessionRows = []
  const answerSets = []
  const reviewRows = []
  let topicCursor = 0 // cycle topics for 'topic' sessions to guarantee coverage

  for (let day = 0; day < TOTAL_DAYS; day++) {
    const n = sessionsForDay(rng)
    for (let s = 0; s < n; s++) {
      const type = chooseType(rng)
      const cfg = TYPE_CONFIG[type]
      const dayProgress = TOTAL_DAYS <= 1 ? 1 : day / (TOTAL_DAYS - 1)

      // Session start time: late afternoon/evening.
      const startHour = 15 + Math.floor(rng() * 5) // 15..19
      const startMin = Math.floor(rng() * 60)
      const started = new Date(START.getTime() + day * DAY_MS)
      started.setUTCHours(startHour, startMin, Math.floor(rng() * 60), 0)
      const expires = new Date(started.getTime() + cfg.limit * 1000)

      // Topic for single-topic sessions cycles through all topics.
      let sessionTopic = null
      if (!cfg.mixed) {
        sessionTopic = TOPICS[topicCursor % TOPICS.length]
        topicCursor++
      }

      // Pick distinct questions.
      const picked = []
      const usedIds = new Set()
      const wantTopics = cfg.mixed ? TOPICS : [sessionTopic]
      let guard = 0
      while (picked.length < cfg.count && guard < cfg.count * 40) {
        guard++
        const t = cfg.mixed ? pick(rng, TOPICS) : sessionTopic
        const candidates = pool.byTopic[t]
        if (!candidates || candidates.length === 0) continue
        const q = pick(rng, candidates)
        if (usedIds.has(q.id)) continue
        usedIds.add(q.id)
        picked.push(q)
      }
      if (picked.length === 0) continue

      // Roughly 6% of sessions expire with trailing skips.
      const expired = rng() < 0.06
      const skipFrom = expired ? Math.max(1, picked.length - (1 + Math.floor(rng() * 3))) : picked.length

      // Per-question grading + answer rows.
      const sessionId = uuid()
      const questionIds = picked.map((q) => q.id)
      let correctCount = 0
      const perAnswerDurMs = Math.min(cfg.limit * 1000, picked.length * (25000 + Math.floor(rng() * 30000)))
      const gap = perAnswerDurMs / picked.length
      const wrongItems = []

      for (let pos = 0; pos < picked.length; pos++) {
        const q = picked[pos]
        const answeredAt = pos < skipFrom ? new Date(started.getTime() + (pos + 1) * gap) : null

        if (answeredAt == null) {
          // Skipped (expired) — ungraded.
          answerSets.push([
            pStr("id", uuid()),
            pStr("session_id", sessionId),
            pStr("question_id", q.id),
            pInt("position", pos),
            pInt("selected_index", null),
            pBool("is_correct", null),
            pStr("topic", q.topic),
            pTs("answered_at", null),
          ])
          wrongItems.push(fallbackItem(q.id, q.topic))
          continue
        }

        const acc = clamp(
          child.base + (child.topicOffset[q.topic] ?? 0) + child.drift * dayProgress,
          0.05,
          0.97,
        )
        const isCorrect = rng() < acc
        let selected = q.correctIndex
        if (!isCorrect) {
          // pick a wrong option index
          do {
            selected = Math.floor(rng() * Math.max(2, q.optCount))
          } while (selected === q.correctIndex)
        }
        if (isCorrect) correctCount++
        else wrongItems.push(fallbackItem(q.id, q.topic))

        agg[q.topic].attempts++
        if (isCorrect) agg[q.topic].correct++

        answerSets.push([
          pStr("id", uuid()),
          pStr("session_id", sessionId),
          pStr("question_id", q.id),
          pInt("position", pos),
          pInt("selected_index", selected),
          pBool("is_correct", isCorrect),
          pStr("topic", q.topic),
          pTs("answered_at", answeredAt),
        ])
      }

      const status = expired ? "expired" : "completed"
      const completedAt = expired ? expires : new Date(started.getTime() + perAnswerDurMs + 5000)
      const helpUsed = rng() < 0.4 ? Math.floor(rng() * 3) : 0

      sessionRows.push({
        id: sessionId,
        type,
        topic: sessionTopic,
        questionIds,
        status,
        started,
        expires,
        completedAt,
        timeLimit: cfg.limit,
        helpUsed,
        score: correctCount,
        total: picked.length,
      })

      // Review report (deterministic fallback summary) for the session.
      const perTopicSummary = summarise(answerSetsForSession(answerSets, sessionId, picked))
      const sw = strongestWeakest(perTopicSummary)
      reviewRows.push({
        sessionId,
        summary: {
          perTopicSummary,
          strongestTopic: sw.strongest,
          weakestTopic: sw.weakest,
          items: wrongItems,
          status: "complete",
        },
        createdAt: completedAt,
      })
    }
  }

  return { sessionRows, answerSets, reviewRows, agg }
}

// Build per-topic summary from the picked questions + their grading by reading
// back from the answerSets we just pushed for this session.
function answerSetsForSession(answerSets, sessionId, picked) {
  const ids = new Set(picked.map((q) => q.id))
  return answerSets
    .filter((set) => set[1].value.stringValue === sessionId)
    .map((set) => ({
      topic: set[6].value.stringValue,
      isCorrect: set[5].value.isNull ? null : set[5].value.booleanValue,
    }))
}

function summarise(answers) {
  const m = new Map()
  for (const a of answers) {
    if (a.isCorrect === null) continue
    const e = m.get(a.topic) ?? { attempted: 0, correct: 0 }
    e.attempted++
    if (a.isCorrect) e.correct++
    m.set(a.topic, e)
  }
  return [...m.entries()].map(([topic, v]) => ({ topic, attempted: v.attempted, correct: v.correct }))
}

function strongestWeakest(summary) {
  const ranked = summary
    .filter((e) => e.attempted >= 1)
    .map((e) => ({ topic: e.topic, ratio: e.correct / e.attempted }))
  if (ranked.length === 0) return { strongest: "n/a", weakest: "n/a" }
  const strongest = ranked.reduce((b, c) => (c.ratio > b.ratio || (c.ratio === b.ratio && c.topic < b.topic) ? c : b))
  if (ranked.length < 2) return { strongest: strongest.topic, weakest: "n/a" }
  const weakest = ranked.reduce((w, c) => (c.ratio < w.ratio || (c.ratio === w.ratio && c.topic < w.topic) ? c : w))
  return { strongest: strongest.topic, weakest: weakest.topic }
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------
const INSERT_SESSION = `INSERT INTO sessions
  (id, child_id, parent_id, type, topic, question_ids, status, started_at, expires_at, completed_at, time_limit_seconds, help_used, score, total)
  VALUES (:id, :child_id, :parent_id, :type::session_type, :topic::topic, :question_ids::jsonb, :status::session_status,
          :started_at, :expires_at, :completed_at, :time_limit_seconds, :help_used, :score, :total)`

const INSERT_ANSWERS = `INSERT INTO session_answers
  (id, session_id, question_id, position, selected_index, is_correct, topic, answered_at)
  VALUES (:id, :session_id, :question_id, :position, :selected_index, :is_correct, :topic::topic, :answered_at)`

const UPSERT_PROGRESS = `INSERT INTO progress
  (id, child_id, topic, attempts, correct, mastery_score, classification, updated_at)
  VALUES (:id, :child_id, :topic::topic, :attempts, :correct, :mastery_score, :classification::mastery_classification, now())
  ON CONFLICT (child_id, topic) DO UPDATE SET
    attempts = EXCLUDED.attempts, correct = EXCLUDED.correct,
    mastery_score = EXCLUDED.mastery_score, classification = EXCLUDED.classification, updated_at = now()`

const INSERT_REVIEW = `INSERT INTO review_reports (id, session_id, summary, generated_by, created_at)
  VALUES (:id, :session_id, :summary::jsonb, 'fallback', :created_at)
  ON CONFLICT (session_id) DO NOTHING`

async function writeChild(child, gen) {
  // Sessions (one statement each — they carry a per-row casted enum/jsonb).
  for (const s of gen.sessionRows) {
    await exec(INSERT_SESSION, [
      pStr("id", s.id),
      pStr("child_id", child.id),
      pStr("parent_id", PARENT_ID),
      pStr("type", s.type),
      pStr("topic", s.topic),
      pJson("question_ids", s.questionIds),
      pStr("status", s.status),
      pTs("started_at", s.started),
      pTs("expires_at", s.expires),
      pTs("completed_at", s.completedAt),
      pInt("time_limit_seconds", s.timeLimit),
      pInt("help_used", s.helpUsed),
      pInt("score", s.score),
      pInt("total", s.total),
    ])
  }
  // Answers (batched).
  await batch(INSERT_ANSWERS, gen.answerSets)

  // Review reports (batched-ish; one each is fine).
  for (const r of gen.reviewRows) {
    await exec(INSERT_REVIEW, [
      pStr("id", uuid()),
      pStr("session_id", r.sessionId),
      pJson("summary", r.summary),
      pTs("created_at", r.createdAt),
    ])
  }

  // Progress rollup.
  for (const topic of TOPICS) {
    const { attempts, correct } = gen.agg[topic]
    const mastery = attempts > 0 ? Math.round((correct / attempts) * 10000) / 100 : 0
    const cls = classify(attempts, attempts > 0 ? correct / attempts : 0)
    await exec(UPSERT_PROGRESS, [
      pStr("id", uuid()),
      pStr("child_id", child.id),
      pStr("topic", topic),
      pInt("attempts", attempts),
      pInt("correct", correct),
      pNum("mastery_score", mastery),
      pStr("classification", cls),
    ])
  }
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------
async function verify() {
  for (const child of CHILDREN) {
    const rows = await exec(
      `SELECT topic, attempts, correct, mastery_score, classification
       FROM progress WHERE child_id = :id ORDER BY topic`,
      [pStr("id", child.id)],
    )
    const totalAttempts = rows.reduce((s, r) => s + Number(r.attempts), 0)
    const totalCorrect = rows.reduce((s, r) => s + Number(r.correct), 0)
    const overall = totalAttempts ? Math.round((totalCorrect / totalAttempts) * 1000) / 10 : 0
    const sess = await exec(
      `SELECT status, count(*) AS n FROM sessions WHERE child_id = :id GROUP BY status`,
      [pStr("id", child.id)],
    )
    console.log(`\n${child.name}  (target ~${Math.round(child.base * 100)}%)  overall=${overall}%`)
    console.log("  sessions:", sess.map((r) => `${r.status}=${r.n}`).join("  "))
    for (const r of rows) {
      console.log(
        `  ${String(r.topic).padEnd(32)} att=${String(r.attempts).padStart(3)} ` +
          `correct=${String(r.correct).padStart(3)} mastery=${String(r.mastery_score).padStart(6)} ${r.classification}`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (process.argv.includes("--verify")) {
    await verify()
    return
  }

  console.log(`Region=${REGION} db=${DATABASE}`)
  console.log("Loading question pool ...")
  const pool = await loadQuestionPool()
  console.log(`  ${pool.all} active questions`)

  const childIds = CHILDREN.map((c) => c.id)
  console.log("Clearing existing sessions + progress for the 3 demo children ...")
  await wipe(childIds)

  for (const child of CHILDREN) {
    console.log(`Setting year group + generating for ${child.name} ...`)
    await exec(`UPDATE children SET year_group = :y WHERE id = :id`, [
      pInt("y", child.year),
      pStr("id", child.id),
    ])
    const gen = await generateForChild(child, pool)
    await writeChild(child, gen)
    console.log(
      `  ${child.name}: ${gen.sessionRows.length} sessions, ${gen.answerSets.length} answers, ${gen.reviewRows.length} reviews`,
    )
  }

  console.log("\nDone. Verifying ...")
  await verify()
}

main().catch((err) => {
  console.error("\nDemo data generation failed:", err)
  process.exit(1)
})
