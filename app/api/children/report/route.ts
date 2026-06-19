import { streamText } from "ai"
import { z } from "zod"
import { requireEntitledParent } from "@/lib/auth/guard"
import { buildReportInput } from "@/lib/ai/report-data"
import { REPORT_JSON_INSTRUCTION } from "@/lib/ai/report"
import { appModel, appModelSource } from "@/lib/ai/model"
import { audit } from "@/lib/db/audit"

// Never use the edge runtime with the AI SDK.
export const runtime = "nodejs"
export const maxDuration = 30

const bodySchema = z.object({ childId: z.string().min(1).max(64) })

/**
 * Streams the AI parent progress report as raw JSON (Claude Sonnet 4.6 on
 * Bedrock) via `streamText`. The client consumes it with `experimental_useObject`,
 * which parses the partial JSON as it arrives, so the report's fields render
 * PROGRESSIVELY from ~1s.
 *
 * Why not `streamObject`: the Bedrock provider buffers structured/tool-mode
 * output and emits it in a single chunk at the very end (~15-17s) — so it never
 * streams. Asking for raw JSON over `streamText` streams token-by-token; the
 * `REPORT_JSON_INSTRUCTION` (kept in sync with `reportSchema`) pins the shape,
 * and the client's tolerant partial-JSON rendering handles mid-stream fragments.
 * PII-free input; scoped to the owning parent.
 */
export async function POST(req: Request) {
  let parent
  try {
    const result = await requireEntitledParent()
    parent = result.parent
  } catch {
    return Response.json({ error: "Not authorised." }, { status: 401 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 })

  const input = await buildReportInput(parsed.data.childId, parent.id)
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status })

  const t0 = performance.now()
  const result = streamText({
    model: appModel(),
    system: `${input.system}\n\n${REPORT_JSON_INSTRUCTION}`,
    prompt: input.prompt,
    temperature: 0.4,
    onFinish: ({ usage }) => {
      const ms = Math.round(performance.now() - t0)
      console.info(
        `[report-timing] childId=${parsed.data.childId} ms=${ms} source=${appModelSource()} usage=${JSON.stringify(usage)}`,
      )
      void audit({
        action: "ai.report_generated",
        parentId: parent.id,
        detail: { childId: parsed.data.childId, source: appModelSource() },
      })
    },
  })

  return result.toTextStreamResponse({
    headers: {
      // Defeat proxy/CDN buffering so partial frames reach the client as they
      // are produced (otherwise a report could "drop in" at the end).
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}
