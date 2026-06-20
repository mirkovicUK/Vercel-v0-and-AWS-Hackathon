/**
 * Deterministic seeded pseudo-random number generator (mulberry32).
 *
 * Given the same numeric seed this always yields the identical sequence of
 * floats in the half-open range `[0, 1)`. It is used purely for tie-breaks in
 * adaptive question selection (e.g. choosing between candidates that are
 * equidistant from the target difficulty), so that selection is reproducible
 * under a fixed seed in tests while still varying run-to-run in production
 * when a fresh seed is supplied.
 *
 * This module is intentionally PURE: it performs no I/O and imports nothing
 * from `server-only`, the database, or `next/*`. (Requirements 5.3, 5.4, 19.1)
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function (): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
