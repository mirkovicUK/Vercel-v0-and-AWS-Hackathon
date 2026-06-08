// Feature: practice-billing-gdpr-completion, Property 3: At most one active session per child
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import type { SessionStatus } from "@/lib/domain"
import { isSessionActive } from "./sessions"

/**
 * Property 3: At most one active session per child.
 *
 * The real enforcement is split between a DB partial unique index
 * (`uniq_active_session_per_child ON sessions(child_id) WHERE status = 'active'`)
 * and the application guard in `startSessionAction` (which calls `getActiveSession`
 * first), neither of which can run against Aurora in a unit test. So we test the
 * INVARIANT MODEL with an in-memory fake of "the sessions for one child" that
 * captures exactly the rule used in production:
 *
 *   - getActiveSession / the active-slot rule: status === 'active' && now <= expires_at
 *     (expressed by the pure `isSessionActive` helper exported from sessions.ts).
 *   - startSessionAction: reject a start while a non-expired active session exists;
 *     an expired (or terminal) session does not block a new start.
 *
 * We exercise arbitrary interleavings of start / end / advance-time operations and
 * after each one assert the invariant: the count of sessions that are active at the
 * current modelled time is <= 1.
 */

// Each session has a fixed lifespan (time limit); it expires once now passes expiresAt.
interface ModelSession {
  id: number
  status: SessionStatus
  expiresAt: number // epoch ms
}

const SESSION_LIFESPAN_MS = 1000

/** In-memory model of the active-session rule for a single child. */
class OneChildSessionModel {
  private sessions: ModelSession[] = []
  private nowMs: number
  private nextId = 1

  constructor(startMs: number) {
    this.nowMs = startMs
  }

  private now(): Date {
    return new Date(this.nowMs)
  }

  /** Mirror of getActiveSession: the single active, non-expired session, or null. */
  private getActiveSession(): ModelSession | null {
    return this.sessions.find((s) => isSessionActive(s.status, new Date(s.expiresAt), this.now())) ?? null
  }

  /** Count of sessions active at the current modelled time. */
  activeCount(): number {
    return this.sessions.filter((s) => isSessionActive(s.status, new Date(s.expiresAt), this.now())).length
  }

  /**
   * Mirror of startSessionAction + the partial unique index: rejected iff a
   * non-expired active session exists. Returns the created session id or null
   * if rejected.
   */
  start(): number | null {
    if (this.getActiveSession() !== null) return null // rejected by guard + unique index
    const session: ModelSession = {
      id: this.nextId++,
      status: "active",
      expiresAt: this.nowMs + SESSION_LIFESPAN_MS,
    }
    this.sessions.push(session)
    return session.id
  }

  /** Mirror of endSession: move an active session to a terminal status. */
  end(sessionId: number): void {
    const session = this.sessions.find((s) => s.id === sessionId)
    if (session && session.status === "active") {
      session.status = "abandoned"
    }
  }

  /**
   * Advance modelled time. Expired-but-still-`active` rows are flipped to `expired`
   * lazily, mirroring expireIfElapsed; this does not affect the active rule because
   * isSessionActive already treats a past-expiry active row as not active.
   */
  advanceTime(deltaMs: number): void {
    this.nowMs += deltaMs
    for (const s of this.sessions) {
      if (s.status === "active" && this.nowMs > s.expiresAt) {
        s.status = "expired"
      }
    }
  }

  /** id of any currently-active session, for follow-up operations. */
  activeId(): number | null {
    return this.getActiveSession()?.id ?? null
  }
}

type Op =
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "advance"; ms: number }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.constant<Op>({ kind: "start" }),
  fc.constant<Op>({ kind: "end" }),
  // advance by a range that straddles the session lifespan so sessions both
  // survive and expire across the generated sequences.
  fc.integer({ min: 0, max: 2 * SESSION_LIFESPAN_MS }).map<Op>((ms) => ({ kind: "advance", ms })),
)

describe("Property 3: At most one active session per child", () => {
  it("never has more than one active session across any interleaving of start/end/expire", () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 60 }), (ops) => {
        const model = new OneChildSessionModel(Date.now())

        // Invariant holds for the empty/initial state.
        expect(model.activeCount()).toBeLessThanOrEqual(1)

        for (const op of ops) {
          const activeBefore = model.activeCount()

          if (op.kind === "start") {
            const wasActive = activeBefore === 1
            const id = model.start()

            if (wasActive) {
              // A start while one is active must be rejected and must NOT push the
              // active count beyond 1 (Req 4.1).
              expect(id).toBeNull()
              expect(model.activeCount()).toBe(1)
            } else {
              // A start when none is active succeeds; active count becomes exactly 1 (Req 4.3).
              expect(id).not.toBeNull()
              expect(model.activeCount()).toBe(1)
            }
          } else if (op.kind === "end") {
            const id = model.activeId()
            if (id !== null) model.end(id)
            // Ending the active session leaves no active session (Req 4.5).
            if (id !== null) expect(model.activeId()).toBeNull()
          } else {
            model.advanceTime(op.ms)
          }

          // Core invariant after every operation (Req 4.1, 4.4).
          expect(model.activeCount()).toBeLessThanOrEqual(1)
        }
      }),
      { numRuns: 200 },
    )
  })

  it("a start succeeds again once the prior active session has expired", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), () => {
        const model = new OneChildSessionModel(Date.now())

        const first = model.start()
        expect(first).not.toBeNull()
        expect(model.activeCount()).toBe(1)

        // While active, a second start is rejected (Req 4.1).
        expect(model.start()).toBeNull()
        expect(model.activeCount()).toBe(1)

        // After expiry, the slot frees up and a new start succeeds (Req 4.3, 4.4).
        model.advanceTime(SESSION_LIFESPAN_MS + 1)
        expect(model.activeCount()).toBe(0)
        const second = model.start()
        expect(second).not.toBeNull()
        expect(model.activeCount()).toBe(1)
      }),
      { numRuns: 100 },
    )
  })

  it("a start succeeds again once the prior active session has ended", () => {
    const model = new OneChildSessionModel(Date.now())

    const first = model.start()
    expect(first).not.toBeNull()
    expect(model.start()).toBeNull() // blocked while active

    model.end(first as number)
    expect(model.activeCount()).toBe(0)

    const second = model.start()
    expect(second).not.toBeNull()
    expect(model.activeCount()).toBe(1)
  })
})

describe("isSessionActive predicate mirrors production semantics", () => {
  it("is active only when status is 'active' and now <= expiresAt", () => {
    const now = new Date("2025-01-01T00:00:00Z")
    const future = new Date("2025-01-01T00:01:00Z")
    const past = new Date("2024-12-31T23:59:00Z")

    expect(isSessionActive("active", future, now)).toBe(true)
    expect(isSessionActive("active", now, now)).toBe(true) // boundary: now == expiresAt
    expect(isSessionActive("active", past, now)).toBe(false) // expired
    expect(isSessionActive("completed", future, now)).toBe(false)
    expect(isSessionActive("expired", future, now)).toBe(false)
    expect(isSessionActive("abandoned", future, now)).toBe(false)
  })
})
