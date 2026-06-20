/**
 * Selection_Core — the PURE, deterministic, I/O-free heart of adaptive
 * question selection.
 *
 * This module performs all weighting, allocation, difficulty targeting,
 * recency exclusion, fallback, and cold-start logic for the `adaptive`
 * ("Skill builder") session type. Every export depends only on its arguments
 * (and, where relevant, an injected `() => number` RNG), so the whole module
 * is fully property-testable with `fast-check`.
 *
 * It is intentionally PURE: it imports ONLY from `@/lib/domain` and performs no
 * I/O — nothing from `server-only`, the database, or `next/*`. (Req 19.1)
 */
import {
  type Topic,
  type WeightingDirection,
  TOPICS,
  MASTERY_MAX,
} from "@/lib/domain"

/** A selectable question, reduced to only what selection needs. */
export interface Candidate {
  id: string
  difficulty: number // 1..5
}

/** Per-topic mastery snapshot (mirrors getChildProgress output). */
export interface TopicMasteryInput {
  masteryScore: number // 0..100
  attempts: number // graded attempts; >=1 ⇒ Attempted_Topic
}

/** Per-difficulty accuracy snapshot (mirrors getAccuracyByDifficulty output). */
export interface DifficultyAccuracyInput {
  difficulty: number // 1..5
  attempts: number
  pct: number // 0..100
}

export interface SelectionConfig {
  total: number // session total (15 for adaptive)
  weightingDirection: WeightingDirection
  gamma: number
  coverageFloor: number
  targetAccuracy: number // 0..1
  defaultDifficulty: number
  difficultyMin: number
  difficultyMax: number
}

export interface SelectionInput {
  mastery: Record<Topic, TopicMasteryInput> // all six topics present
  accuracyByDifficulty: DifficultyAccuracyInput[] // only attempted levels need be present
  candidatePools: Record<Topic, Candidate[]> // active questions per topic
  recentlyAnswered: ReadonlySet<string> // question ids answered within the window
  config: SelectionConfig
}

export interface SelectionMetadata {
  calibrating: boolean // Cold_Start ⇒ true (Req 8.4)
  deficit: number // total - selectedIds.length, >=0 (Req 7.6)
  targetDifficulty: number // chosen ZPD centre (Req 5)
  fallbacksApplied: {
    // per-topic record of relaxations (Req 7)
    widenedDifficulty: Topic[]
    droppedRecency: Topic[]
    reallocatedFrom: Topic[] // topics that gave up shortfall
    reallocatedTo: Topic[] // topics that absorbed shortfall
  }
}

export interface SelectionResult {
  selectedIds: string[] // ordered, distinct (Req 7.7)
  allocation: Record<Topic, number> // per-topic counts; sums to selectedIds.length
  metadata: SelectionMetadata
}

/**
 * Tiny positive floor applied to an Attempted_Topic's weighting base BEFORE
 * exponentiation. This guarantees that at least one strictly positive weight
 * always exists, even at the mastery extremes where the natural base would be
 * exactly 0 (e.g. every attempted topic at mastery 100 under `weak_weighted`,
 * or at mastery 0 under `strong_weighted`). (Req 2.6)
 */
const WEIGHT_EPSILON = 1e-9

/**
 * Cold-start detection. (Req 8.1)
 *
 * PURE and deterministic. Returns `true` iff the sum of `attempts` across all
 * six topics is exactly 0 — i.e. the child has never had a graded attempt on
 * any topic, so there is no mastery signal to weight by. Cold start is
 * per-child (the input is one child's mastery snapshot), independent of
 * siblings.
 */
export function isColdStart(mastery: Record<Topic, TopicMasteryInput>): boolean {
  let totalAttempts = 0
  for (const topic of TOPICS) {
    totalAttempts += mastery[topic].attempts
  }
  return totalAttempts === 0
}

/**
 * Compute per-topic weights from a mastery snapshot. (Req 2.3, 2.4, 2.5, 2.6, 3.7)
 *
 * PURE and deterministic: identical inputs always yield identical weights.
 *
 * For each Attempted_Topic (`attempts >= 1`):
 *   - `weak_weighted`:   weight = (MASTERY_MAX - masteryScore) ** gamma
 *                        → strictly decreasing in mastery (weaker ≥ stronger).
 *   - `strong_weighted`: weight = masteryScore ** gamma
 *                        → non-decreasing in mastery (stronger ≥ weaker).
 *
 * Unattempted topics (`attempts < 1`) receive weight 0 so they are not
 * allocated outside cold start (Req 3.7).
 *
 * The base for an attempted topic is floored to a tiny epsilon BEFORE the
 * exponentiation, so even when every attempted topic sits at the relevant
 * mastery extreme there is always at least one strictly positive weight
 * (Req 2.6).
 */
export function computeTopicWeights(
  mastery: Record<Topic, TopicMasteryInput>,
  direction: WeightingDirection,
  gamma: number,
): Record<Topic, number> {
  const weights = Object.fromEntries(TOPICS.map((t) => [t, 0])) as Record<Topic, number>

  for (const topic of TOPICS) {
    const { masteryScore, attempts } = mastery[topic]
    if (attempts < 1) {
      // Unattempted topic: no weight outside cold start (Req 3.7).
      weights[topic] = 0
      continue
    }

    const base =
      direction === "weak_weighted" ? MASTERY_MAX - masteryScore : masteryScore

    // Floor the base to a strictly positive epsilon before exponentiation so a
    // positive weight always survives at the mastery extremes (Req 2.6).
    const flooredBase = Math.max(base, WEIGHT_EPSILON)
    weights[topic] = flooredBase ** gamma
  }

  return weights
}

/**
 * Allocate `total` questions across topics using a coverage floor plus the
 * Hamilton (largest-remainder) method. (Req 3.1–3.6, 4.1–4.4)
 *
 * PURE and deterministic. The returned record always contains all six topics
 * (unattempted topics — weight 0 — always receive 0), and the allocated counts
 * sum to EXACTLY `total` (Req 3.3/3.4/4.4) — this exactness is a hard invariant
 * enforced by a final reconciliation pass, even if reconciliation locally
 * breaks the weighting preference.
 *
 * Algorithm (mirrors design "Step 4 — Coverage floor + Hamilton allocation"):
 *   Let attemptedTopics = topics with weight > 0; A = attemptedTopics.length.
 *   - If A > total: sort attempted topics by weight DESC (ties by fixed TOPICS
 *     order), give 1 to the top `total` topics and 0 to the rest. (Req 4.2)
 *   - Else (A <= total): reserve `coverageFloor` per attempted topic, then
 *     distribute the remaining units by Hamilton largest-remainder over the
 *     normalised quotas (quota_t = weight_t / Σweight * remainingUnits): floor
 *     each, then hand out leftover units one at a time to the largest
 *     fractional remainder; ties broken by fixed TOPICS order. (Req 3.2/3.5/4.1)
 *
 * The `coverageFloor` reservation is guarded so the reserved units can never
 * exceed `total`; any imbalance is corrected by the reconciliation pass.
 */
export function hamiltonAllocate(
  weights: Record<Topic, number>,
  total: number,
  coverageFloor: number,
): Record<Topic, number> {
  const allocation = Object.fromEntries(TOPICS.map((t) => [t, 0])) as Record<Topic, number>

  // Fixed TOPICS order index, used as the deterministic tie-breaker everywhere.
  const orderIndex = (t: Topic) => TOPICS.indexOf(t)

  // Attempted_Topics = topics with strictly positive weight, in fixed TOPICS order.
  const attempted = TOPICS.filter((t) => weights[t] > 0)
  const A = attempted.length

  // No attempted topics ⇒ nothing to allocate (unattempted topics stay 0).
  if (A === 0 || total <= 0) return allocation

  // --- Branch: more attempted topics than slots (Req 4.2) ---
  // Give 1 to the `total` highest-weighted topics; ties broken by TOPICS order.
  if (A > total) {
    const byWeightDesc = [...attempted].sort((a, b) => {
      if (weights[b] !== weights[a]) return weights[b] - weights[a]
      return orderIndex(a) - orderIndex(b)
    })
    for (let i = 0; i < total; i++) allocation[byWeightDesc[i]] = 1
    return reconcile(allocation, attempted, new Map(), total, orderIndex)
  }

  // --- Branch: A <= total — coverage floor + Hamilton largest-remainder ---
  // Guard so reserved units never exceed total (Req 4.1; defensive for
  // coverageFloor > 1). With coverageFloor = 1 and A <= total this is exact.
  const perTopicFloor = Math.max(0, Math.floor(coverageFloor))
  const reservedTotal = Math.min(A * perTopicFloor, total)
  for (const t of attempted) allocation[t] = perTopicFloor
  // If the floor over-reserved, trim back down to `total` deterministically below.

  const remainingUnits = Math.max(0, total - A * perTopicFloor)

  const totalWeight = attempted.reduce((sum, t) => sum + weights[t], 0)
  const remainders = new Map<Topic, number>()

  if (remainingUnits > 0 && totalWeight > 0) {
    let distributed = 0
    for (const t of attempted) {
      const quota = (weights[t] / totalWeight) * remainingUnits
      const floorQ = Math.floor(quota)
      allocation[t] += floorQ
      distributed += floorQ
      remainders.set(t, quota - floorQ)
    }

    // Hand out the leftover units to the largest fractional remainders first;
    // ties broken by fixed TOPICS order (Req 3.5).
    let leftover = remainingUnits - distributed
    const byRemainderDesc = [...attempted].sort((a, b) => {
      const ra = remainders.get(a) ?? 0
      const rb = remainders.get(b) ?? 0
      if (rb !== ra) return rb - ra
      return orderIndex(a) - orderIndex(b)
    })
    for (let i = 0; leftover > 0 && i < byRemainderDesc.length; i++, leftover--) {
      allocation[byRemainderDesc[i]] += 1
    }
  } else {
    // No remaining units to distribute: every attempted topic has 0 remainder.
    for (const t of attempted) remainders.set(t, 0)
  }

  // Hard invariant: Σ allocation === total exactly (Req 3.3/3.4/4.4).
  // (reservedTotal is referenced to keep the guard explicit even when exact.)
  void reservedTotal
  return reconcile(allocation, attempted, remainders, total, orderIndex)
}

/**
 * Final reconciliation pass that enforces the hard invariant `Σ allocation ===
 * total` exactly (Req 3.3/3.4/4.4). Units are added/removed one at a time in
 * largest-remainder order, then fixed TOPICS order — even if this locally
 * breaks the weighting preference. Only Attempted_Topics are ever touched, so
 * unattempted topics remain 0. Mutates and returns `allocation`.
 */
function reconcile(
  allocation: Record<Topic, number>,
  attempted: Topic[],
  remainders: Map<Topic, number>,
  total: number,
  orderIndex: (t: Topic) => number,
): Record<Topic, number> {
  if (attempted.length === 0) return allocation

  const order = [...attempted].sort((a, b) => {
    const ra = remainders.get(a) ?? 0
    const rb = remainders.get(b) ?? 0
    if (rb !== ra) return rb - ra
    return orderIndex(a) - orderIndex(b)
  })

  const sum = () => attempted.reduce((s, t) => s + allocation[t], 0)

  // Too few: add single units cycling through largest-remainder order.
  let guard = 0
  while (sum() < total && guard < total * attempted.length + attempted.length + 1) {
    allocation[order[guard % order.length]] += 1
    guard++
  }

  // Too many: remove single units cycling through the same order, never below 0.
  guard = 0
  const maxIters = total * attempted.length + attempted.length + 1
  let i = 0
  while (sum() > total && guard < maxIters) {
    const t = order[i % order.length]
    if (allocation[t] > 0) allocation[t] -= 1
    i++
    guard++
  }

  return allocation
}

/**
 * Derive the Target_Difficulty_Band — the ZPD centre. (Req 5.1, 5.6, 5.7)
 *
 * PURE and deterministic. Among the supplied per-difficulty accuracy entries,
 * consider ONLY difficulty levels that have actually been attempted
 * (`attempts >= 1`); a level with no graded attempts carries no signal and is
 * ignored — its accuracy is never extrapolated (Req 5.7). Among the attempted
 * levels, return the difficulty whose measured accuracy (`pct / 100`) is
 * CLOSEST to `targetAccuracy` (the centre of the 70–80% window, 0.75).
 *
 * Equal-distance ties break toward the LOWER difficulty: a gentler, more
 * deterministic challenge (Req 5.1).
 *
 * If NO level has any attempts (no data at all), fall back to the configured
 * middle `defaultDifficulty` rather than guessing (Req 5.6).
 */
export function targetDifficultyBand(
  accuracy: DifficultyAccuracyInput[],
  targetAccuracy: number,
  defaultDifficulty: number,
): number {
  // Only attempted levels carry signal; never extrapolate the rest (Req 5.7).
  const attempted = accuracy.filter((a) => a.attempts >= 1)

  // No accuracy data at all ⇒ default to the configured middle band (Req 5.6).
  if (attempted.length === 0) return defaultDifficulty

  let best = attempted[0]
  let bestDistance = Math.abs(best.pct / 100 - targetAccuracy)

  for (let i = 1; i < attempted.length; i++) {
    const candidate = attempted[i]
    const distance = Math.abs(candidate.pct / 100 - targetAccuracy)

    if (
      distance < bestDistance ||
      // Equal distance ⇒ prefer the lower difficulty (Req 5.1).
      (distance === bestDistance && candidate.difficulty < best.difficulty)
    ) {
      best = candidate
      bestDistance = distance
    }
  }

  return best.difficulty
}

/**
 * Deterministic in-place Fisher–Yates shuffle driven by the injected `rng`.
 *
 * PURE relative to `(arr, rng)`: given the same array contents and the same
 * RNG state/sequence it always produces the same permutation. Used ONLY to
 * break ties between equidistant candidates and to scramble the cold-start
 * pool, so selection is reproducible under a fixed seed (Req 5.3/5.4).
 */
function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

/**
 * Order candidates by absolute distance from the `target` difficulty
 * (nearest-first, Req 5.2), breaking ties WITHIN each equal-distance bucket
 * using the injected `rng` via a Fisher–Yates shuffle (Req 5.3). Buckets are
 * visited in ascending distance order; the RNG is consumed deterministically.
 */
function orderByDistance(cands: Candidate[], target: number, rng: () => number): Candidate[] {
  const buckets = new Map<number, Candidate[]>()
  for (const c of cands) {
    const d = Math.abs(c.difficulty - target)
    const bucket = buckets.get(d)
    if (bucket) bucket.push(c)
    else buckets.set(d, [c])
  }
  const distances = [...buckets.keys()].sort((a, b) => a - b)
  const ordered: Candidate[] = []
  for (const d of distances) {
    ordered.push(...shuffleInPlace([...buckets.get(d)!], rng))
  }
  return ordered
}

/**
 * Selection_Core entry point — the full 8-step adaptive selection algorithm.
 * (Design "Selection algorithm (in detail)", Steps 1–8.)
 *
 * PURE and deterministic given `(input, rng)`: it performs no I/O and uses
 * `rng` ONLY for tie-breaks/shuffles (Req 19.1, 5.4). It returns the ordered,
 * DISTINCT selected ids (Req 7.7), the FINAL per-topic allocation recomputed
 * from the actually-selected ids (so `Σ allocation === selectedIds.length` and
 * each `allocation_t` equals the count of selected ids of that topic —
 * Req 9.1 / Property 13), and metadata (calibrating, deficit, targetDifficulty,
 * fallbacksApplied).
 *
 * Guarantees:
 *  - Distinctness (Req 7.7): a single GLOBAL `chosen` Set gates every take, so
 *    no id is ever selected twice — including during reallocation.
 *  - Completeness (Req 7.5 / 8.5): when the number of distinct active
 *    candidates across all topics is `>= total`, the fallback chain (and, in
 *    cold start, the mixed-pool draw) always reaches exactly `total` distinct
 *    ids, because reallocation sweeps EVERY topic (attempted or not) for any
 *    remaining unused candidate, dropping both the difficulty band and recency.
 *  - Scarcity (Req 7.6): when fewer than `total` distinct candidates exist, it
 *    returns all of them, never exceeds `total`, and reports
 *    `metadata.deficit = total - selectedIds.length` (always `>= 0`).
 */
export function selectAdaptiveQuestions(
  input: SelectionInput,
  rng: () => number,
): SelectionResult {
  const { mastery, accuracyByDifficulty, candidatePools, recentlyAnswered, config } = input
  const { total, weightingDirection, gamma, coverageFloor, targetAccuracy, defaultDifficulty } =
    config

  // Target difficulty band is computed for every path and always surfaced in
  // metadata, even for cold start (Step 5; Req 5.1/5.6/5.7).
  const target = targetDifficultyBand(accuracyByDifficulty, targetAccuracy, defaultDifficulty)

  const fallbacksApplied: SelectionMetadata["fallbacksApplied"] = {
    widenedDifficulty: [],
    droppedRecency: [],
    reallocatedFrom: [],
    reallocatedTo: [],
  }

  // GLOBAL distinctness gate (Req 7.7) shared across every take below.
  const chosen = new Set<string>()
  const selectedIds: string[] = []

  // id → topic, used to recompute the FINAL allocation from selected ids
  // (Property 13). Question ids are globally unique; first pool wins.
  const idToTopic = new Map<string, Topic>()
  for (const t of TOPICS) {
    for (const c of candidatePools[t]) {
      if (!idToTopic.has(c.id)) idToTopic.set(c.id, t)
    }
  }

  /** Append a candidate to the selection if not already chosen and under the cap. */
  const tryTake = (id: string): boolean => {
    if (selectedIds.length >= total) return false
    if (chosen.has(id)) return false
    chosen.add(id)
    selectedIds.push(id)
    return true
  }

  const calibrating = isColdStart(mastery)

  if (calibrating) {
    // --- Step 8: Cold-start uniform mixed sampling (Req 8.2/8.3/8.5) ---
    // Pool ALL candidates across topics (distinct by id), in fixed TOPICS order.
    const allCandidates: Candidate[] = []
    const seen = new Set<string>()
    for (const t of TOPICS) {
      for (const c of candidatePools[t]) {
        if (seen.has(c.id)) continue
        seen.add(c.id)
        allCandidates.push(c)
      }
    }

    // Exclude recently-answered ids ONLY while doing so still leaves enough
    // distinct candidates to meet the total; otherwise skip the exclusion in
    // the spirit of the fallback chain (Req 8.3).
    const nonRecent = allCandidates.filter((c) => !recentlyAnswered.has(c.id))
    const pool = nonRecent.length >= total ? nonRecent : allCandidates

    // Deterministic shuffle, then take `total` distinct ids.
    const shuffled = shuffleInPlace([...pool], rng)
    for (const c of shuffled) {
      if (selectedIds.length >= total) break
      tryTake(c.id)
    }
  } else {
    // --- Steps 2–4: weights → Hamilton allocation with coverage floor ---
    const weights = computeTopicWeights(mastery, weightingDirection, gamma)
    const allocation = hamiltonAllocate(weights, total, coverageFloor)

    // --- Step 6 + Step 7 (a/b) per topic: take with widen + drop-recency ---
    const shortfall = Object.fromEntries(TOPICS.map((t) => [t, 0])) as Record<Topic, number>

    for (const topic of TOPICS) {
      const need = allocation[topic]
      if (need <= 0) continue

      let taken = 0
      const available = candidatePools[topic].filter((c) => !chosen.has(c.id))
      const nonRecent = available.filter((c) => !recentlyAnswered.has(c.id))

      // Step 6 + Step 7a (widen difficulty): non-recent candidates ordered
      // nearest-first across ALL difficulties. Consuming any candidate beyond
      // the exact target band means the band was widened (Req 7.1).
      let widened = false
      for (const c of orderByDistance(nonRecent, target, rng)) {
        if (taken >= need) break
        if (Math.abs(c.difficulty - target) > 0) widened = true
        if (tryTake(c.id)) taken += 1
      }
      if (widened) fallbacksApplied.widenedDifficulty.push(topic)

      // Step 7b (drop recency): re-admit recently-answered ids for THIS topic
      // only, re-ordered by distance, to fill the remaining allocation (Req 7.2).
      if (taken < need) {
        const recent = candidatePools[topic].filter(
          (c) => recentlyAnswered.has(c.id) && !chosen.has(c.id),
        )
        let droppedRecency = false
        for (const c of orderByDistance(recent, target, rng)) {
          if (taken >= need) break
          if (tryTake(c.id)) {
            taken += 1
            droppedRecency = true
          }
        }
        if (droppedRecency) fallbacksApplied.droppedRecency.push(topic)
      }

      if (taken < need) shortfall[topic] = need - taken
    }

    // --- Step 7c: reallocate the remaining shortfall across topics (Req 7.3/7.5) ---
    let remaining = TOPICS.reduce((sum, t) => sum + shortfall[t], 0)
    if (remaining > 0) {
      const donors: Topic[] = []
      // Visit ALL topics (attempted or not) in fixed TOPICS order so any spare
      // distinct unused candidate can absorb the shortfall; recency is dropped
      // here too so completeness (Req 7.5) holds whenever candidates exist.
      for (const donor of TOPICS) {
        if (remaining <= 0) break
        const available = candidatePools[donor].filter((c) => !chosen.has(c.id))
        const nonRecent = available.filter((c) => !recentlyAnswered.has(c.id))
        const recent = available.filter((c) => recentlyAnswered.has(c.id))
        const ordered = [
          ...orderByDistance(nonRecent, target, rng),
          ...orderByDistance(recent, target, rng),
        ]
        let donated = 0
        for (const c of ordered) {
          if (remaining <= 0) break
          if (tryTake(c.id)) {
            donated += 1
            remaining -= 1
          }
        }
        if (donated > 0) donors.push(donor)
      }

      if (donors.length > 0) {
        // Topics that gave up their unmet allocation (Req 7.3 bookkeeping).
        for (const t of TOPICS) {
          if (shortfall[t] > 0) fallbacksApplied.reallocatedFrom.push(t)
        }
        fallbacksApplied.reallocatedTo.push(...donors)
      }
    }
  }

  // --- Recompute the FINAL allocation from the actually-selected ids so that
  // Σ allocation === selectedIds.length and each allocation_t equals the count
  // of selected ids whose topic is t (Req 9.1 / Property 13). ---
  const finalAllocation = Object.fromEntries(TOPICS.map((t) => [t, 0])) as Record<Topic, number>
  for (const id of selectedIds) {
    const t = idToTopic.get(id)
    if (t) finalAllocation[t] += 1
  }

  // Never exceeds total ⇒ deficit is always >= 0 (Req 7.6).
  const deficit = total - selectedIds.length

  return {
    selectedIds,
    allocation: finalAllocation,
    metadata: {
      calibrating,
      deficit,
      targetDifficulty: target,
      fallbacksApplied,
    },
  }
}
