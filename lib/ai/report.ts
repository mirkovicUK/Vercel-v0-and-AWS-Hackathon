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
