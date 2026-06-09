import { describe, expect, it } from "vitest"
import fc from "fast-check"
import { MockLanguageModelV3 } from "ai/test"
import type { LanguageModel } from "ai"
import { generateReviewExplanations, type ReviewItemContext } from "./review"
import { TOPICS, type Topic } from "@/lib/domain"

// Feature: practice-billing-gdpr-completion, Property 8: Review always finalises with text for every item, regardless of the model

/**
 * The five model behaviours Property 8 must survive (Req 8.2-8.6):
 *  - ok:        valid, non-empty structured output -> "nova" result
 *  - throw:     the model call rejects (network / provider error) -> fallback
 *  - hang:      the model never resolves -> per-call timeout / budget -> fallback
 *  - empty:     well-formed JSON but blank fields -> validation fails -> fallback
 *  - malformed: non-JSON text the structured-output parser rejects -> fallback
 */
type Behaviour = "ok" | "throw" | "hang" | "empty" | "malformed"
const BEHAVIOURS: Behaviour[] = ["ok", "throw", "hang", "empty", "malformed"]

// A token embedded in each item's questionText so the single shared mock model
// can dispatch the correct behaviour per call, independent of call ordering or
// concurrency (the prompt is the only per-item signal the model receives).
const TOKEN_RE = /\[\[B:(ok|throw|hang|empty|malformed)\]\]/

/** Build a minimal-but-complete LanguageModelV3 generate result carrying `text`. */
function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  }
}

/**
 * A single fake model shared across all items. It inspects the prompt for the
 * behaviour token and reacts accordingly. No real Bedrock / Gateway call is
 * ever made, so the suite is fast and deterministic.
 */
function makeMockModel(): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      const promptText = JSON.stringify(options.prompt)
      const behaviour = (TOKEN_RE.exec(promptText)?.[1] ?? "ok") as Behaviour

      switch (behaviour) {
        case "throw":
          throw new Error("simulated model failure")
        case "hang":
          // Never resolves: forces the per-call timeout / overall budget path.
          return new Promise(() => {}) as never
        case "empty":
          return textResult(JSON.stringify({ explanation: "   ", nextStep: "" }))
        case "malformed":
          return textResult("this is not the JSON the schema expects <<>>")
        case "ok":
        default:
          return textResult(
            JSON.stringify({
              explanation: "Add the tens then the units to reach the total.",
              nextStep: "Try three more addition questions tonight.",
            }),
          )
      }
    },
  }) as unknown as LanguageModel
}

// ---- Generators -----------------------------------------------------------

const topicArb: fc.Arbitrary<Topic> = fc.constantFrom(...TOPICS)

/** One wrong-answer context plus the behaviour the model should exhibit for it. */
const itemArb = (index: number): fc.Arbitrary<ReviewItemContext> =>
  fc
    .record({
      behaviour: fc.constantFrom(...BEHAVIOURS),
      topic: topicArb,
      questionText: fc.string({ maxLength: 40 }),
      options: fc.array(fc.string({ maxLength: 12 }), { minLength: 0, maxLength: 4 }),
      correctAnswerText: fc.string({ maxLength: 20 }),
      selectedAnswerText: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
      attempted: fc.boolean(),
      imageDescription: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
      yearGroup: fc.option(fc.constantFrom(4, 5, 6), { nil: null }),
    })
    .map((r) => ({
      questionId: `q-${index}`,
      topic: r.topic,
      // Embed the behaviour token so the shared mock can dispatch per item.
      questionText: `[[B:${r.behaviour}]] ${r.questionText}`,
      options: r.options,
      correctAnswerText: r.correctAnswerText,
      selectedAnswerText: r.selectedAnswerText,
      attempted: r.attempted,
      imageDescription: r.imageDescription,
      yearGroup: r.yearGroup,
    }))

const itemsArb: fc.Arbitrary<ReviewItemContext[]> = fc
  .integer({ min: 0, max: 6 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => itemArb(i))))

// Small timeouts/budgets keep 100+ runs fast. Both orderings are exercised:
// when perCallTimeoutMs < overallBudgetMs the per-call timeout binds; when the
// budget is the smaller value the overall-budget overrun path binds. Either way
// every hung/failed item must still finalise with deterministic fallback text.
const configArb = fc.record({
  perCallTimeoutMs: fc.integer({ min: 5, max: 40 }),
  overallBudgetMs: fc.integer({ min: 5, max: 60 }),
  maxConcurrency: fc.integer({ min: 1, max: 6 }),
})

// ---- Property -------------------------------------------------------------

describe("generateReviewExplanations — Property 8 (total robustness)", () => {
  it("never throws and returns one non-empty result per item for any model behaviour", async () => {
    await fc.assert(
      fc.asyncProperty(itemsArb, configArb, async (items, config) => {
        const model = makeMockModel()

        // Must never throw, regardless of model behaviour.
        const results = await generateReviewExplanations(items, config, model)

        // Exactly one result per input item, in input order (questionId aligns).
        expect(results).toHaveLength(items.length)
        for (let i = 0; i < items.length; i++) {
          expect(results[i].questionId).toBe(items[i].questionId)
          // Every result has non-empty explanation and nextStep.
          expect(typeof results[i].explanation).toBe("string")
          expect(results[i].explanation.trim().length).toBeGreaterThan(0)
          expect(typeof results[i].nextStep).toBe("string")
          expect(results[i].nextStep.trim().length).toBeGreaterThan(0)
          // Source is always one of the two valid sentinels.
          expect(["nova", "fallback"]).toContain(results[i].source)
        }
      }),
      { numRuns: 120 },
    )
  })
})
