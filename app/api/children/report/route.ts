import { generateObject } from "ai"
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
 * Generates the AI parent progress report as a single schema-VALIDATED object
 * (Claude Haiku 4.5 on Bedrock) and returns it as JSON.
 *
 * We deliberately do NOT stream: the report is short (~300 tokens, a few
 * seconds), and `generateObject` guarantees the full object validates against
 * `reportSchema` before it reaches the client — so every section (strengths,
 * focus areas, next steps) is always present and correctly typed. PII-free
 * input; scoped to the owning parent.
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
  try {
    const { object, usage, finishReason } = await generateObject({
      model: reportModel(),
      schema: reportSchema,
      system: input.system,
      prompt: input.prompt,
      temperature: 0.4,
    })

    const ms = Math.round(performance.now() - t0)
    console.info(
      `[report-timing] childId=${parsed.data.childId} ms=${ms} source=${tutorModelSource()} finishReason=${finishReason} usage=${JSON.stringify(usage)}`,
    )

    void audit({
      action: "ai.report_generated",
      parentId: parent.id,
      detail: { childId: parsed.data.childId, source: tutorModelSource() },
    })

    return Response.json(object)
  } catch (err) {
    const ms = Math.round(performance.now() - t0)
    console.warn(
      `[report-timing] childId=${parsed.data.childId} ms=${ms} FAILED err=${err instanceof Error ? err.message : String(err)}`,
    )
    return Response.json(
      { error: "Could not generate a report right now. Please try again shortly." },
      { status: 502 },
    )
  }
}
