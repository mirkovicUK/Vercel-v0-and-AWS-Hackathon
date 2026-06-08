import { describe, expect, it } from "vitest"
import fc from "fast-check"
import { decideTrialEligibility, type TrialDecision } from "./actions"

// Feature: practice-billing-gdpr-completion, Property 1: Trial granted iff eligible
// Validates: Requirements 2.1, 2.2, 2.3, 2.4, 18.5
describe("decideTrialEligibility — Property 1: Trial granted iff eligible", () => {
  it("grants a trial exactly when the user is eligible across all input combinations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(), // hasUsedTrial
        fc.option(fc.string({ minLength: 1 }), { nil: null }), // stripeCustomerId: null or a (non-empty) customer id
        fc.nat({ max: 3 }), // priorCount
        fc.boolean(), // lookupThrows
        async (hasUsedTrial, stripeCustomerId, priorCount, lookupThrows) => {
          const listPriorSubscriptions = async (_customerId: string): Promise<number> => {
            if (lookupThrows) throw new Error("stripe lookup failed")
            return priorCount
          }

          const decision = await decideTrialEligibility({
            hasUsedTrial,
            stripeCustomerId,
            listPriorSubscriptions,
          })

          const expected = expectedDecision(hasUsedTrial, stripeCustomerId, priorCount, lookupThrows)

          expect(decision.grantTrial).toBe(expected.grantTrial)
          expect(decision.reason).toBe(expected.reason)
        },
      ),
      { numRuns: 200 },
    )
  })
})

// Reference model encoding the decision rules precisely (Req 2.1–2.4).
function expectedDecision(
  hasUsedTrial: boolean,
  stripeCustomerId: string | null,
  priorCount: number,
  lookupThrows: boolean,
): TrialDecision {
  // 2.1: flag wins outright, no lookup.
  if (hasUsedTrial) return { grantTrial: false, reason: "flag_used" }
  // 2.3: no customer means no history to check — eligible.
  if (!stripeCustomerId) return { grantTrial: true, reason: "eligible" }
  // 2.4: lookup throws — fail-open, grant trial.
  if (lookupThrows) return { grantTrial: true, reason: "lookup_failed_eligible" }
  // 2.2: prior subscription present — no trial.
  if (priorCount >= 1) return { grantTrial: false, reason: "prior_subscription" }
  // 2.3: customer with zero prior subs — eligible.
  return { grantTrial: true, reason: "eligible" }
}
