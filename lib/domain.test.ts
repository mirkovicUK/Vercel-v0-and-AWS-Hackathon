import { describe, expect, it } from "vitest"
import { TOPICS, classifyMastery } from "./domain"

// Smoke test confirming the Vitest runner executes and can import from lib/domain.ts.
describe("test tooling smoke test", () => {
  it("imports domain constants", () => {
    expect(TOPICS.length).toBeGreaterThan(0)
    expect(TOPICS).toContain("number")
  })

  it("imports domain functions", () => {
    expect(typeof classifyMastery).toBe("function")
  })
})
