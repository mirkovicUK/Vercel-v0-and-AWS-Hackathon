import { streamObject } from "ai"
import { z } from "zod"
import { requireEntitledParent } from "@/lib/auth/guard"
import { buildReportInput } from "@/lib/ai/report-data"
import { reportSchema } from "@/lib/ai/report"
import { reportModel, tutorModelSource } from "@/lib/ai/model"
import { audit } from "@/lib/db/audit"

// Never use the edge runtime with the AI SDK.
export const runtime = "nodejs"
export const maxDuration = 30

const bodySchema = z.object({ childId: z.string().min(1).max(64) })

/**
 * Streams the AI parent progress report as a structured object (Claude Sonnet
 * 4.6 on Bedrock). The client consumes it with `experimental_useObject`, so
 * fields appear progressively — which keeps the UX snappy despite Sonnet's
 * lower per-token throughput. Sonnet (vs Haiku) reliably conforms to the
 * schema, so every section is present. PII-free input; scoped to the parent.
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
  const result = streamObject({
    model: reportModel(),
    schema: reportSchema,
    system: input.system,
    prompt: input.prompt,
    temperature: 0.4,
    onFinish: ({ usage }) => {
      const ms = Math.round(performance.now() - t0)
      console.info(
        `[report-timing] childId=${parsed.data.childId} ms=${ms} source=${tutorModelSource()} usage=${JSON.stringify(usage)}`,
      )
      void audit({
        action: "ai.report_generated",
        parentId: parent.id,
        detail: { childId: parsed.data.childId, source: tutorModelSource() },
      })
    },
  })

  return result.toTextStreamResponse({
    headers: {
      // Defeat proxy/CDN buffering so partial object frames reach the client as
      // they are produced (otherwise the whole report "drops in" at the end).
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}
