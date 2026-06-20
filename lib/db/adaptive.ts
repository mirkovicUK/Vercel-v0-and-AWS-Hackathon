import "server-only"
import { query } from "@/lib/aws/rds-data"
import { getChildProgress } from "@/lib/db/progress"
import { getAccuracyByDifficulty } from "@/lib/db/analytics"
import {
  selectAdaptiveQuestions,
  type Candidate,
  type TopicMasteryInput,
  type DifficultyAccuracyInput,
  type SelectionConfig,
  type SelectionInput,
  type SelectionResult,
} from "@/lib/practice/adaptive-selection"
import { mulberry32 } from "@/lib/practice/rng"
import {
  TOPICS,
  type Topic,
  SESSION_TYPE_CONFIG,
  DEFAULT_WEIGHTING_DIRECTION,
  WEIGHTING_GAMMA,
  COVERAGE_FLOOR,
  ZPD_TARGET_ACCURACY,
  DEFAULT_DIFFICULTY,
  DIFFICULTY_MIN,
  DIFFICULTY_MAX,
  RECENCY_WINDOW_DAYS,
} from "@/lib/domain"

/**
 * Selection_Service — the thin, server-only orchestrator for the `adaptive`
 * ("Skill builder") session type.
 *
 * Its sole job is to gather the pure Selection_Core's inputs from Aurora
 * (per-topic mastery, accuracy-by-difficulty, the active candidate pools, and
 * the recently-answered set), run the deterministic core under a per-request
 * seeded RNG, and shape the result into the `{ questionIds, questionTopics }`
 * contract that `createSession` already expects. All weighting, allocation,
 * ZPD targeting, recency exclusion, fallback, and cold-start logic lives in the
 * PURE core (`lib/practice/adaptive-selection.ts`); nothing of substance is
 * decided here. (Design §3 "Selection_Service — server orchestration")
 */

export interface AdaptiveSelection {
  questionIds: string[]
  questionTopics: Topic[] // topic per id, same order, for createSession
  allocation: Record<Topic, number>
  metadata: SelectionResult["metadata"]
}

/**
 * Active questions per topic, reduced to `{ id, difficulty }`. (Req 7 inputs)
 *
 * All active questions are projected to id + difficulty + topic in one round
 * trip, then grouped client-side into per-topic pools. The returned record
 * always contains all six TOPICS (zero-filled with empty arrays) so the core
 * can index every topic unconditionally. Mirrors `pickQuestionIds` conventions:
 * no string interpolation of values, only static SQL here.
 */
async function getCandidatePools(): Promise<Record<Topic, Candidate[]>> {
  const rows = await query<{ id: string; topic: Topic; difficulty: number }>(
    `SELECT id, topic, difficulty FROM questions WHERE active ORDER BY topic, difficulty`,
  )
  const pools = Object.fromEntries(TOPICS.map((t) => [t, [] as Candidate[]])) as Record<
    Topic,
    Candidate[]
  >
  for (const r of rows) {
    // Defensive: ignore any unexpected/legacy topic value not in the curriculum.
    if (pools[r.topic]) pools[r.topic].push({ id: r.id, difficulty: r.difficulty })
  }
  return pools
}

/**
 * Distinct question ids the child answered within the recency window. (Req 6)
 *
 * `child_id` is not on `session_answers` — it lives on `sessions` and is reached
 * through `session_id`, so this anti-join source joins
 * `session_answers → sessions ON session_id` and filters on
 * `sessions.child_id` + `session_answers.answered_at`. The window interval is
 * bound as a parameter (no string interpolation of values).
 */
async function getRecentlyAnsweredSet(childId: string, windowDays: number): Promise<Set<string>> {
  const rows = await query<{ question_id: string }>(
    `SELECT DISTINCT sa.question_id
       FROM session_answers sa
       JOIN sessions s ON s.id = sa.session_id
      WHERE s.child_id = :childId
        AND sa.answered_at IS NOT NULL
        AND sa.answered_at >= now() - (:windowDays::int * interval '1 day')`,
    { childId, windowDays },
  )
  return new Set(rows.map((r) => r.question_id))
}

/**
 * Small deterministic string hash (FNV-1a, 32-bit) used only to fold the
 * `childId` into the per-request RNG seed so concurrent requests for different
 * children don't collide on `Date.now()` alone. Not security-sensitive.
 */
function hashString(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Gather Aurora inputs, run the pure core, and shape the result for
 * `createSession`. (Req 6.1, 6.3, 7.1, 19.1)
 *
 * Reads that don't depend on one another are issued in parallel. A fresh seed
 * is derived per request (sessions should differ run-to-run), so production
 * selection varies while the core stays deterministic given that seed.
 */
export async function selectAdaptiveQuestionsForChild(childId: string): Promise<AdaptiveSelection> {
  const [progress, accuracyRows, candidatePools, recentlyAnswered] = await Promise.all([
    getChildProgress(childId),
    getAccuracyByDifficulty(childId),
    getCandidatePools(),
    getRecentlyAnsweredSet(childId, RECENCY_WINDOW_DAYS),
  ])

  // Build the per-topic mastery snapshot, zero-filled for all six topics.
  const masteryByTopic = new Map(progress.map((p) => [p.topic, p]))
  const mastery = Object.fromEntries(
    TOPICS.map((t): [Topic, TopicMasteryInput] => {
      const p = masteryByTopic.get(t)
      return [t, { masteryScore: p?.masteryScore ?? 0, attempts: p?.attempts ?? 0 }]
    }),
  ) as Record<Topic, TopicMasteryInput>

  // Pass accuracy-by-difficulty straight through, reduced to the core's shape.
  const accuracyByDifficulty: DifficultyAccuracyInput[] = accuracyRows.map((r) => ({
    difficulty: r.difficulty,
    attempts: r.attempts,
    pct: r.pct,
  }))

  // Build the SelectionConfig from the single source of truth in lib/domain.
  const config: SelectionConfig = {
    total: SESSION_TYPE_CONFIG.adaptive.questionCount,
    weightingDirection: DEFAULT_WEIGHTING_DIRECTION,
    gamma: WEIGHTING_GAMMA,
    coverageFloor: COVERAGE_FLOOR,
    targetAccuracy: ZPD_TARGET_ACCURACY,
    defaultDifficulty: DEFAULT_DIFFICULTY,
    difficultyMin: DIFFICULTY_MIN,
    difficultyMax: DIFFICULTY_MAX,
  }

  const input: SelectionInput = {
    mastery,
    accuracyByDifficulty,
    candidatePools,
    recentlyAnswered,
    config,
  }

  // Per-request seed: fold a small string hash of childId into the clock so
  // distinct children requesting at the same instant get distinct sequences.
  const seed = (Date.now() ^ hashString(childId)) >>> 0
  const rng = mulberry32(seed)

  const result = selectAdaptiveQuestions(input, rng)

  // Map each selected id back to its topic via the candidate pools, producing
  // questionTopics in selectedIds order — the contract createSession expects.
  const idToTopic = new Map<string, Topic>()
  for (const t of TOPICS) {
    for (const c of candidatePools[t]) {
      if (!idToTopic.has(c.id)) idToTopic.set(c.id, t)
    }
  }
  const questionTopics = result.selectedIds.map((id) => idToTopic.get(id)!) as Topic[]

  return {
    questionIds: result.selectedIds,
    questionTopics,
    allocation: result.allocation,
    metadata: result.metadata,
  }
}
