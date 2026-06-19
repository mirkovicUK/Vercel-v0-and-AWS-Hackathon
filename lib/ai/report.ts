import { z } from "zod"

/**
 * Shared schema + type for the AI parent progress report. Lives outside the
 * server action / route so the client streaming hook (`experimental_useObject`)
 * can validate the partial object as it streams in. Zod is client-safe.
 */
export const reportSchema = z.object({
  momentum: z
    .string()
    .describe("One short sentence on the trend/direction of travel (improving, plateauing, or slipping), grounded in the velocity and per-topic momentum data"),
  summary: z.string().describe("2-3 sentence parent-facing overview of how the learner is doing"),
  strengths: z.array(z.string()).describe("2-4 short, specific strengths"),
  focusAreas: z
    .array(z.object({ topic: z.string(), advice: z.string() }))
    .describe("1-3 topics to improve, each with one concrete, encouraging tip"),
  nextSteps: z.array(z.string()).describe("2-3 concrete recommended actions for the next week"),
})

export type ReviewReport = z.infer<typeof reportSchema>

/**
 * Instruction appended to the system prompt so the model emits the report as a
 * single raw JSON object matching `reportSchema`.
 *
 * WHY raw-JSON-via-streamText instead of `streamObject`: the Bedrock provider
 * buffers structured/tool-mode output and emits it in ONE chunk at the very end
 * (~15-17s), so `streamObject` never actually streams here. Asking for raw JSON
 * over `streamText` streams token-by-token from ~1s, and the client parses the
 * partial JSON progressively (the same `parsePartialJson` that `useObject` uses).
 * Keep this shape in sync with `reportSchema` above.
 */
export const REPORT_JSON_INSTRUCTION = `Output ONLY a single raw minified JSON object matching this exact shape — no markdown, no code fences, no commentary before or after:
{"momentum":string,"summary":string,"strengths":string[],"focusAreas":[{"topic":string,"advice":string}],"nextSteps":string[]}`
