/**
 * Compare Sonnet 4.6 invocation paths from London (eu-west-2): the GLOBAL
 * cross-region inference profile vs the EU regional profile vs a bare model id.
 *
 * For each candidate it measures (via streamText, the path that actually
 * streams) time-to-first-token and total duration, so we can see the latency
 * saving of staying in-region. Skips ids that aren't invokable on your account.
 *
 * USAGE:
 *   node scripts/region-probe.mjs
 *   PROBE_RUNS=3 node scripts/region-probe.mjs   # average over N runs each
 *
 * Creds: AWS_ACCESS_KEY_ID/SECRET in env, else ~/.aws/credentials [AWS_PROFILE|default].
 */
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { streamText } from "ai"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
function loadEnvFile(name) {
  const p = join(root, name)
  if (!existsSync(p)) return
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}
loadEnvFile(".env.local")
loadEnvFile(".env")

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-west-2"
const RUNS = Number(process.env.PROBE_RUNS || 1)

function readAwsProfileCreds(profile) {
  const path = join(process.env.HOME || process.env.USERPROFILE || "", ".aws", "credentials")
  if (!existsSync(path)) return null
  let current = null
  const f = {}
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim()
    const sec = line.match(/^\[(.+)\]$/)
    if (sec) { current = sec[1]; continue }
    if (current !== profile) continue
    const kv = line.match(/^([\w_]+)\s*=\s*(.+)$/)
    if (kv) f[kv[1].toLowerCase()] = kv[2].trim()
  }
  return f.aws_access_key_id && f.aws_secret_access_key
    ? { accessKeyId: f.aws_access_key_id, secretAccessKey: f.aws_secret_access_key, sessionToken: f.aws_session_token }
    : null
}

let creds
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  creds = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  }
} else {
  creds = readAwsProfileCreds(process.env.AWS_PROFILE || "default")
}
if (!creds) {
  console.error("✗ No AWS credentials found.")
  process.exit(1)
}

const bedrock = createAmazonBedrock({ region: REGION, ...creds })

// Candidate ids to compare from London. `global.` is what the app uses now;
// `eu.` is the in-region EU profile; the bare id is what the user mentioned.
const CANDIDATES = [
  "global.anthropic.claude-sonnet-4-6",
  "eu.anthropic.claude-sonnet-4-6",
  "anthropic.claude-sonnet-4-6",
]

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000
const fmt = (ms) => `${ms.toFixed(0)}ms`

const system = "You are a concise assistant."
const prompt = "Write 3 short sentences about why practising mental maths daily helps a child."

async function measure(modelId) {
  const model = bedrock(modelId)
  const t0 = now()
  let firstToken = null
  let chunks = 0
  let chars = 0
  const result = streamText({ model, system, prompt, temperature: 0.4 })
  for await (const delta of result.textStream) {
    if (firstToken === null) firstToken = now() - t0
    chunks++
    chars += delta.length
  }
  const total = now() - t0
  const usage = await result.usage
  return { ttft: firstToken, total, chunks, chars, usage }
}

async function main() {
  console.log(`region probe — region=${REGION}, runs/each=${RUNS}\n`)
  const results = {}
  for (const id of CANDIDATES) {
    const samples = []
    let failed = null
    for (let i = 0; i < RUNS; i++) {
      try {
        samples.push(await measure(id))
      } catch (e) {
        failed = e.message?.split("\n")[0] || String(e)
        break
      }
    }
    if (failed) {
      console.log(`✗ ${id}\n    not usable: ${failed}\n`)
      continue
    }
    const avg = (k) => samples.reduce((a, s) => a + s[k], 0) / samples.length
    const r = { ttft: avg("ttft"), total: avg("total"), chunks: Math.round(avg("chunks")) }
    results[id] = r
    console.log(`✓ ${id}`)
    console.log(`    TTFT (avg) : ${fmt(r.ttft)}`)
    console.log(`    total (avg): ${fmt(r.total)}`)
    console.log(`    chunks     : ${r.chunks}\n`)
  }

  const base = results["global.anthropic.claude-sonnet-4-6"]
  if (base) {
    console.log("=== Savings vs global profile (TTFT is the user-felt latency) ===")
    for (const [id, r] of Object.entries(results)) {
      if (id === "global.anthropic.claude-sonnet-4-6") continue
      const ttftSave = base.ttft - r.ttft
      const totalSave = base.total - r.total
      const pct = base.ttft > 0 ? ((ttftSave / base.ttft) * 100).toFixed(0) : "0"
      console.log(`  ${id}`)
      console.log(`    TTFT  : ${fmt(r.ttft)} vs ${fmt(base.ttft)}  → saves ${fmt(ttftSave)} (${pct}%)`)
      console.log(`    total : ${fmt(r.total)} vs ${fmt(base.total)}  → saves ${fmt(totalSave)}`)
    }
  }
  console.log("\nNote: cross-region inference does not change per-token PRICE; the saving here is LATENCY.")
}

main().catch((e) => {
  console.error("region probe failed:", e)
  process.exit(1)
})
