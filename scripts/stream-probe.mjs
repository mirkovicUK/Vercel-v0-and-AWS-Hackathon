/**
 * Local streaming probe for the AI parent report pipeline — NO deploy, NO auth, NO DB.
 *
 * It reproduces exactly what `/api/children/report` does (streamObject → Bedrock
 * Sonnet 4.6 → toTextStreamResponse) and measures WHERE the latency is, so you
 * can tell the difference between:
 *   (1) Bedrock buffering / high time-to-first-token, vs
 *   (2) HTTP transport buffering (the "drops in at the end" symptom), vs
 *   (3) streamObject field-granularity (object only updates once JSON is parseable).
 *
 * It runs two phases against the SAME model + schema:
 *   PHASE A — Direct SDK: iterate result.textStream AND result.partialObjectStream,
 *             timestamping every chunk. Answers "does Bedrock stream progressively?"
 *   PHASE B — Full transport: spin up a tiny local HTTP server that returns
 *             streamObject(...).toTextStreamResponse() (mirroring route.ts), then
 *             a raw browser-style client (fetch + res.body.getReader()) reads it,
 *             timestamping each NETWORK chunk. Answers "is the wire buffering?"
 *
 * USAGE (needs AWS creds for Bedrock, same as the app):
 *   AWS_REGION=eu-west-2 \
 *   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... [AWS_SESSION_TOKEN=...] \
 *   node scripts/stream-probe.mjs
 *
 * Optional env:
 *   PROBE_MODEL_ID   override the Bedrock model id (default global.anthropic.claude-sonnet-4-6)
 *   PROBE_PHASE      "a" | "b" | "both" (default both)
 *   PROBE_PORT       local server port for phase B (default 7777)
 *
 * A .env.local in the project root (Next convention) is auto-loaded if present.
 */
import { readFileSync, existsSync } from "node:fs"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { streamObject, streamText, Output, parsePartialJson } from "ai"
import { z } from "zod"

// ---------------------------------------------------------------------------
// env: load .env.local (Next does this for the app; standalone node does not).
// ---------------------------------------------------------------------------
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
function loadEnvFile(name) {
  const p = join(root, name)
  if (!existsSync(p)) return
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    let val = m[2]
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}
loadEnvFile(".env.local")
loadEnvFile(".env")

const MODEL_ID = process.env.PROBE_MODEL_ID || "global.anthropic.claude-sonnet-4-6"
const PHASE = (process.env.PROBE_PHASE || "both").toLowerCase()
const PORT = Number(process.env.PROBE_PORT || 7777)
// Region: env wins, else fall back so the AWS SDK can still resolve from ~/.aws/config.
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-west-2"

// Credentials: prefer explicit static keys in env (mirrors local dev). If absent,
// read them from the selected ~/.aws/credentials profile (AWS_PROFILE or "default").
// OIDC (AWS_ROLE_ARN) only works on Vercel, so we do NOT use it here.
function readAwsProfileCreds(profile) {
  const path = join(process.env.HOME || process.env.USERPROFILE || "", ".aws", "credentials")
  if (!existsSync(path)) return null
  const text = readFileSync(path, "utf8")
  const lines = text.split("\n")
  let current = null
  const found = {}
  for (const raw of lines) {
    const line = raw.trim()
    const sec = line.match(/^\[(.+)\]$/)
    if (sec) {
      current = sec[1]
      continue
    }
    if (current !== profile) continue
    const kv = line.match(/^([\w_]+)\s*=\s*(.+)$/)
    if (kv) found[kv[1].toLowerCase()] = kv[2].trim()
  }
  if (found.aws_access_key_id && found.aws_secret_access_key) {
    return {
      accessKeyId: found.aws_access_key_id,
      secretAccessKey: found.aws_secret_access_key,
      sessionToken: found.aws_session_token,
    }
  }
  return null
}

let creds = null
let credsSource = ""
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  creds = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  }
  credsSource = "static env keys"
} else {
  const profile = process.env.AWS_PROFILE || "default"
  creds = readAwsProfileCreds(profile)
  credsSource = creds ? `~/.aws/credentials [${profile}]` : "none"
}
if (!creds) {
  console.error(
    "✗ No credentials. Either export AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, set AWS_PROFILE,\n" +
      "  or add static keys to ~/.aws/credentials. (OIDC only works on Vercel.)",
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// model + schema + prompt: mirror lib/ai/model.ts, lib/ai/report.ts, report-data.ts
// (canned stats so we need no DB).
// ---------------------------------------------------------------------------
const bedrock = createAmazonBedrock({
  region: REGION,
  accessKeyId: creds.accessKeyId,
  secretAccessKey: creds.secretAccessKey,
  sessionToken: creds.sessionToken,
})
const model = bedrock(MODEL_ID)
console.log(`creds source: ${credsSource} | region=${REGION}`)

const reportSchema = z.object({
  momentum: z.string().describe("One short sentence on the trend/direction of travel"),
  summary: z.string().describe("2-3 sentence parent-facing overview"),
  strengths: z.array(z.string()).describe("2-4 short, specific strengths"),
  focusAreas: z.array(z.object({ topic: z.string(), advice: z.string() })).describe("1-3 topics to improve"),
  nextSteps: z.array(z.string()).describe("2-3 concrete recommended actions"),
})

const system = `You are an experienced UK 11+ maths tutor writing a short progress report for a parent.
Refer to the student as "your child". Base every statement strictly on the statistics provided.
Be warm, specific and practical. Return only the structured report, no preamble.`

const prompt = `Here are the latest practice statistics for a Year 5 student:

Overall mastery: 68% (trend: improving, +6 pts vs last session)
Sessions completed (recent): 5
Weakest topic: Fractions (41%)

Per-topic mastery:
- Arithmetic: 82% (secure, 41/50 correct)
- Fractions: 41% (developing, 12/29 correct)
- Geometry: 64% (developing, 18/28 correct)

Recent per-topic momentum (change in accuracy):
- Fractions: +9 pts (now 41%)
- Geometry: -4 pts (now 64%)

Accuracy by question difficulty (1 = easiest, 5 = hardest):
- Level 1: 95% (19/20)
- Level 3: 70% (14/20)
- Level 5: 38% (6/16)

Skipped/unanswered questions: 7 total (most in Fractions: 4) — may indicate time pressure.

Write the progress report.`

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000 // ms, float
const fmt = (ms) => `${ms.toFixed(1)}ms`

function buildStream() {
  return streamObject({ model, schema: reportSchema, system, prompt, temperature: 0.4 })
}

// ---------------------------------------------------------------------------
// PHASE A — direct SDK timing (text deltas + partial-object reveal).
// ---------------------------------------------------------------------------
async function phaseA() {
  console.log(`\n=== PHASE A: direct SDK (model=${MODEL_ID}, region=${REGION}) ===`)

  // a.1 raw text deltas — this is what flows over the wire. (Own stream: the SDK
  // locks the underlying stream, so textStream and partialObjectStream cannot be
  // read from the same call — we use two calls.)
  const t0 = now()
  const r1 = buildStream()
  let firstText = null
  let lastText = t0
  let textChunks = 0
  let totalChars = 0
  const gaps = []
  for await (const delta of r1.textStream) {
    const t = now()
    if (firstText === null) firstText = t - t0
    else gaps.push(t - lastText)
    lastText = t
    textChunks++
    totalChars += delta.length
  }
  const usage = await r1.usage
  const totalText = now() - t0

  // a.2 partial object reveal — when does each schema field first appear?
  const t1 = now()
  const r2 = buildStream()
  const fieldFirstSeen = {}
  for await (const partial of r2.partialObjectStream) {
    const t = now() - t1
    for (const k of Object.keys(partial ?? {})) {
      if (fieldFirstSeen[k] === undefined && partial[k] !== undefined) fieldFirstSeen[k] = t
    }
  }

  const maxGap = gaps.length ? Math.max(...gaps) : 0
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0

  console.log(`  [text stream]`)
  console.log(`  time-to-first-text-chunk : ${firstText === null ? "n/a" : fmt(firstText)}`)
  console.log(`  text chunks              : ${textChunks}  (${totalChars} chars total)`)
  console.log(`  inter-chunk gap avg/max  : ${fmt(avgGap)} / ${fmt(maxGap)}`)
  console.log(`  total stream duration    : ${fmt(totalText)}`)
  console.log(`  usage                    : ${JSON.stringify(usage)}`)
  console.log(`  [partial object stream] field first-seen (ms from start):`)
  for (const k of ["momentum", "summary", "strengths", "focusAreas", "nextSteps"]) {
    console.log(`    - ${k.padEnd(11)}: ${fieldFirstSeen[k] === undefined ? "never" : fmt(fieldFirstSeen[k])}`)
  }

  console.log("\n  VERDICT (Phase A):")
  if (firstText !== null && totalText > 0 && firstText / totalText > 0.7) {
    console.log("    → Most time is BEFORE the first chunk: high time-to-first-token (Bedrock/cross-region).")
  } else if (textChunks <= 2) {
    console.log("    → Bedrock returned ~everything in one shot: provider/model is NOT streaming deltas.")
  } else {
    console.log("    → Bedrock IS streaming many deltas over time. If the UI still 'drops in', look at Phase B (transport) or field-granularity below.")
  }
  if (firstText !== null && fieldFirstSeen.momentum !== undefined && fieldFirstSeen.momentum > firstText + 1500) {
    console.log("    → Note: first OBJECT field appears >1.5s after text starts = streamObject field-granularity (a full string must be parseable first).")
  }
}

// ---------------------------------------------------------------------------
// PHASE C — plain streamText (no schema): does the SAME model stream tokens when
// we DON'T ask for a structured object? Confirms whether tool/JSON mode is what
// kills streaming.
// ---------------------------------------------------------------------------
async function phaseC() {
  console.log(`\n=== PHASE C: streamText (no schema, same model) ===`)
  const t0 = now()
  const result = streamText({
    model,
    system,
    prompt: prompt + "\n\nWrite it as a few short plain-text paragraphs.",
    temperature: 0.4,
  })
  let firstText = null
  let lastText = t0
  let chunks = 0
  let chars = 0
  const gaps = []
  for await (const delta of result.textStream) {
    const t = now()
    if (firstText === null) firstText = t - t0
    else gaps.push(t - lastText)
    lastText = t
    chunks++
    chars += delta.length
  }
  const total = now() - t0
  const maxGap = gaps.length ? Math.max(...gaps) : 0
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0
  console.log(`  time-to-first-chunk      : ${firstText === null ? "n/a" : fmt(firstText)}`)
  console.log(`  text chunks              : ${chunks}  (${chars} chars total)`)
  console.log(`  inter-chunk gap avg/max  : ${fmt(avgGap)} / ${fmt(maxGap)}`)
  console.log(`  total                    : ${fmt(total)}`)
  console.log("\n  VERDICT (Phase C):")
  if (chunks > 5) {
    console.log("    → streamText DOES stream token-by-token on this model. => switching the report off structured `streamObject` (or streaming text + parsing) fixes the UX.")
  } else {
    console.log("    → Even plain streamText returns ~1 chunk => the model/region/provider isn't streaming at all (not a structured-mode problem).")
  }
}

// ---------------------------------------------------------------------------
// PHASE D — streamText + experimental_output (structured text, NOT tool mode).
// If THIS streams progressively, Option B is cheap: the SDK gives us a partial
// object stream while still streaming text token-by-token.
// ---------------------------------------------------------------------------
async function phaseD() {
  console.log(`\n=== PHASE D: streamText + experimental_output(object) ===`)

  // d.1 underlying text deltas (own call — stream gets locked).
  const t0 = now()
  const r1 = streamText({
    model,
    system,
    prompt,
    temperature: 0.4,
    experimental_output: Output.object({ schema: reportSchema }),
  })
  let firstText = null
  let textChunks = 0
  let chars = 0
  for await (const delta of r1.textStream) {
    if (firstText === null) firstText = now() - t0
    textChunks++
    chars += delta.length
  }
  const totalText = now() - t0

  // d.2 partial object reveal timing.
  const t1 = now()
  const r2 = streamText({
    model,
    system,
    prompt,
    temperature: 0.4,
    experimental_output: Output.object({ schema: reportSchema }),
  })
  const fieldFirstSeen = {}
  let partialUpdates = 0
  for await (const partial of r2.partialOutputStream) {
    partialUpdates++
    const t = now() - t1
    for (const k of Object.keys(partial ?? {})) {
      if (fieldFirstSeen[k] === undefined && partial[k] !== undefined) fieldFirstSeen[k] = t
    }
  }

  console.log(`  [text stream] first chunk: ${firstText === null ? "n/a" : fmt(firstText)}  chunks: ${textChunks}  (${chars} chars)  total: ${fmt(totalText)}`)
  console.log(`  [partial output] updates : ${partialUpdates}`)
  console.log(`  field first-seen (ms from start):`)
  for (const k of ["momentum", "summary", "strengths", "focusAreas", "nextSteps"]) {
    console.log(`    - ${k.padEnd(11)}: ${fieldFirstSeen[k] === undefined ? "never" : fmt(fieldFirstSeen[k])}`)
  }
  console.log("\n  VERDICT (Phase D):")
  if (textChunks > 5 && partialUpdates > 3) {
    console.log("    → experimental_output STREAMS (text + progressive partial object). Option B is cheap: use this, no hand-rolled parser.")
  } else if (textChunks > 5) {
    console.log("    → Text streams but partial object updates are few — usable, but partials may be coarse.")
  } else {
    console.log("    → experimental_output BUFFERS like streamObject. Option B must hand-roll a partial-JSON parser over streamText.")
  }
}

async function phaseB() {
  console.log(`\n=== PHASE B: HTTP transport (toTextStreamResponse → fetch → getReader) ===`)

  // Mirror the OLD route.ts: return streamObject(...).toTextStreamResponse()
  // with the same anti-buffering headers, served over a plain node http server.
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/report")) {
      res.writeHead(404).end()
      return
    }
    const result = buildStream()
    const response = result.toTextStreamResponse({
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    })
    res.writeHead(response.status, Object.fromEntries(response.headers))
    // Pipe the web ReadableStream to the node response, flushing each chunk.
    for await (const chunk of response.body) {
      res.write(chunk)
    }
    res.end()
  })

  await new Promise((r) => server.listen(PORT, "127.0.0.1", r))

  // Browser-style consumer: fetch + res.body.getReader(), timestamp each chunk.
  const t0 = now()
  const resp = await fetch(`http://127.0.0.1:${PORT}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ childId: "probe" }),
  })
  console.log(`  status                   : ${resp.status}`)
  console.log(`  transfer-encoding        : ${resp.headers.get("transfer-encoding") || "(none)"}`)
  console.log(`  content-encoding         : ${resp.headers.get("content-encoding") || "(none)"}`)

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let firstChunk = null
  let lastChunk = t0
  let chunks = 0
  let bytes = 0
  const gaps = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const t = now()
    if (firstChunk === null) firstChunk = t - t0
    else gaps.push(t - lastChunk)
    lastChunk = t
    chunks++
    bytes += value.length
    decoder.decode(value, { stream: true })
  }
  const total = now() - t0
  const maxGap = gaps.length ? Math.max(...gaps) : 0

  console.log(`  time-to-first-wire-chunk : ${firstChunk === null ? "n/a" : fmt(firstChunk)}`)
  console.log(`  wire chunks              : ${chunks}  (${bytes} bytes)`)
  console.log(`  max inter-chunk gap      : ${fmt(maxGap)}`)
  console.log(`  total                    : ${fmt(total)}`)

  console.log("\n  VERDICT (Phase B):")
  if (chunks <= 2) {
    console.log(
      "    → The wire delivered ~1 chunk. NOTE: if Phase A also showed 1 chunk, the transport is NOT\n" +
        "      the cause — streamObject only PRODUCED one chunk. The wire just forwarded what it got.",
    )
  } else {
    console.log("    → The wire delivered many chunks progressively = transport is fine.")
  }

  await new Promise((r) => server.close(r))
}

// ---------------------------------------------------------------------------
// PHASE E — Option B end-to-end mechanism: streamText emitting RAW JSON, parsed
// progressively with the SDK's parsePartialJson (the same fn experimental_useObject
// uses). Proves we get (1) streaming + (2) progressive object fields + (3) valid
// final JSON — i.e. the client can keep useObject unchanged.
// ---------------------------------------------------------------------------
async function phaseE() {
  console.log(`\n=== PHASE E: Option B — streamText(raw JSON) + parsePartialJson ===`)
  const jsonSystem =
    system +
    `\n\nOutput ONLY a single raw minified JSON object matching this exact shape — no markdown, no code fences, no prose:\n` +
    `{"momentum":string,"summary":string,"strengths":string[],"focusAreas":[{"topic":string,"advice":string}],"nextSteps":string[]}`

  const t0 = now()
  const result = streamText({ model, system: jsonSystem, prompt, temperature: 0.4 })

  let acc = ""
  let firstText = null
  let textChunks = 0
  const fieldFirstSeen = {}
  let lastState = ""
  for await (const delta of result.textStream) {
    if (firstText === null) firstText = now() - t0
    textChunks++
    acc += delta
    const { value, state } = await parsePartialJson(acc)
    lastState = state
    if (value && typeof value === "object") {
      const t = now() - t0
      for (const k of ["momentum", "summary", "strengths", "focusAreas", "nextSteps"]) {
        if (fieldFirstSeen[k] === undefined && value[k] !== undefined) fieldFirstSeen[k] = t
      }
    }
  }
  const total = now() - t0

  // Final validity: does the accumulated text parse + match the schema?
  let finalValid = false
  let schemaOk = false
  try {
    const obj = JSON.parse(acc)
    finalValid = true
    schemaOk = reportSchema.safeParse(obj).success
  } catch {
    const { value } = await parsePartialJson(acc)
    if (value) schemaOk = reportSchema.safeParse(value).success
  }

  console.log(`  first text chunk         : ${firstText === null ? "n/a" : fmt(firstText)}`)
  console.log(`  text chunks              : ${textChunks}  (${acc.length} chars)`)
  console.log(`  total                    : ${fmt(total)}`)
  console.log(`  starts with '{'          : ${acc.trimStart().startsWith("{")}  (no code fence: ${!acc.includes("\`\`\`")})`)
  console.log(`  final JSON.parse valid   : ${finalValid}   schema-valid: ${schemaOk}   lastPartialState: ${lastState}`)
  console.log(`  field first-seen (ms from start):`)
  for (const k of ["momentum", "summary", "strengths", "focusAreas", "nextSteps"]) {
    console.log(`    - ${k.padEnd(11)}: ${fieldFirstSeen[k] === undefined ? "never" : fmt(fieldFirstSeen[k])}`)
  }
  const distinct = new Set(Object.values(fieldFirstSeen)).size
  console.log("\n  VERDICT (Phase E):")
  if (textChunks > 5 && schemaOk && distinct > 1) {
    console.log("    → WORKS. Streams token-by-token, fields appear PROGRESSIVELY, final JSON is schema-valid.")
    console.log("    → Client keeps experimental_useObject unchanged; server just swaps streamObject→streamText(raw JSON).")
  } else if (textChunks > 5 && schemaOk) {
    console.log("    → Streams + valid, but fields all resolved together (still far better than one 17s lump).")
  } else if (!schemaOk) {
    console.log("    → JSON not schema-valid — tighten the prompt or add a server-side fence stripper / fallback.")
  } else {
    console.log("    → Did not stream — unexpected; re-check model id/region.")
  }
}

// ---------------------------------------------------------------------------
// PHASE F — NEW route transport: local server returning streamText(raw JSON)
// .toTextStreamResponse(), consumed by a getReader client that accumulates +
// parsePartialJson (exactly what experimental_useObject does). This mirrors the
// shipped /api/children/report path end-to-end.
// ---------------------------------------------------------------------------
async function phaseF() {
  console.log(`\n=== PHASE F: NEW route end-to-end (streamText raw JSON → wire → useObject-style parse) ===`)
  const jsonSystem =
    system +
    `\n\nOutput ONLY a single raw minified JSON object matching this exact shape — no markdown, no code fences, no prose:\n` +
    `{"momentum":string,"summary":string,"strengths":string[],"focusAreas":[{"topic":string,"advice":string}],"nextSteps":string[]}`

  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/report")) {
      res.writeHead(404).end()
      return
    }
    const result = streamText({ model, system: jsonSystem, prompt, temperature: 0.4 })
    const response = result.toTextStreamResponse({
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    })
    res.writeHead(response.status, Object.fromEntries(response.headers))
    for await (const chunk of response.body) res.write(chunk)
    res.end()
  })
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r))

  const t0 = now()
  const resp = await fetch(`http://127.0.0.1:${PORT}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ childId: "probe" }),
  })
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let acc = ""
  let firstChunk = null
  let wireChunks = 0
  const fieldFirstSeen = {}
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (firstChunk === null) firstChunk = now() - t0
    wireChunks++
    acc += decoder.decode(value, { stream: true })
    const { value: obj } = await parsePartialJson(acc)
    if (obj && typeof obj === "object") {
      const t = now() - t0
      for (const k of ["momentum", "summary", "strengths", "focusAreas", "nextSteps"]) {
        if (fieldFirstSeen[k] === undefined && obj[k] !== undefined) fieldFirstSeen[k] = t
      }
    }
  }
  const total = now() - t0
  const schemaOk = reportSchema.safeParse(JSON.parse(acc)).success

  console.log(`  transfer-encoding        : ${resp.headers.get("transfer-encoding") || "(none)"}`)
  console.log(`  time-to-first-wire-chunk : ${firstChunk === null ? "n/a" : fmt(firstChunk)}`)
  console.log(`  wire chunks              : ${wireChunks}  (${acc.length} chars)`)
  console.log(`  total                    : ${fmt(total)}   final schema-valid: ${schemaOk}`)
  console.log(`  field first-seen (ms from start):`)
  for (const k of ["momentum", "summary", "strengths", "focusAreas", "nextSteps"]) {
    console.log(`    - ${k.padEnd(11)}: ${fieldFirstSeen[k] === undefined ? "never" : fmt(fieldFirstSeen[k])}`)
  }
  const distinct = new Set(Object.values(fieldFirstSeen)).size
  console.log("\n  VERDICT (Phase F):")
  if (wireChunks > 5 && schemaOk && distinct > 1) {
    console.log("    → SHIPPED PATH STREAMS: many wire chunks, fields reveal progressively, final JSON valid. ✅")
  } else {
    console.log("    → Did not stream progressively — investigate.")
  }
  await new Promise((r) => server.close(r))
}

async function main() {
  console.log(`streaming probe — node ${process.version}`)
  if (PHASE === "a" || PHASE === "both") await phaseA()
  if (PHASE === "c" || PHASE === "both") await phaseC()
  if (PHASE === "d" || PHASE === "both") await phaseD()
  if (PHASE === "e" || PHASE === "both") await phaseE()
  if (PHASE === "f" || PHASE === "both") await phaseF()
  if (PHASE === "b" || PHASE === "both") await phaseB()
  console.log("\nDone.")
}

main().catch((err) => {
  console.error("\nprobe failed:", err)
  process.exit(1)
})
