// Shared domain types & constants for ApexMaths.
// Kept framework-agnostic so they can be used on client and server.

export const TOPICS = [
  "number",
  "fractions_decimals_percentages",
  "ratio_proportion",
  "algebra",
  "geometry",
  "data_handling",
] as const

export type Topic = (typeof TOPICS)[number]

export const TOPIC_LABELS: Record<Topic, string> = {
  number: "Number",
  fractions_decimals_percentages: "Fractions, Decimals & Percentages",
  ratio_proportion: "Ratio & Proportion",
  algebra: "Algebra",
  geometry: "Geometry",
  data_handling: "Data Handling",
}

export const SESSION_TYPES = ["warmup", "topic", "mock", "adaptive"] as const
export type SessionType = (typeof SESSION_TYPES)[number]

export interface SessionTypeConfig {
  type: SessionType
  label: string
  questionCount: number
  timeLimitSeconds: number
  mixedTopics: boolean
  description: string
}

export const SESSION_TYPE_CONFIG: Record<SessionType, SessionTypeConfig> = {
  warmup: {
    type: "warmup",
    label: "Warm-up",
    questionCount: 10,
    timeLimitSeconds: 10 * 60,
    mixedTopics: true,
    description: "10 questions across mixed topics in 10 minutes.",
  },
  topic: {
    type: "topic",
    label: "Practice a topic",
    questionCount: 5,
    timeLimitSeconds: 10 * 60,
    mixedTopics: false,
    description: "5 questions on a single topic in 10 minutes.",
  },
  mock: {
    type: "mock",
    label: "Full mock",
    questionCount: 30,
    timeLimitSeconds: 50 * 60,
    mixedTopics: true,
    description: "30 questions across mixed topics in 50 minutes.",
  },
  adaptive: {
    type: "adaptive",
    label: "Skill builder",
    questionCount: 15,
    timeLimitSeconds: 20 * 60,
    mixedTopics: true,
    description: "15 questions tuned to your child's level across all topics in 20 minutes.",
  },
}

// ---- Adaptive selection configuration (single source of truth) ----
// Pure tuning constants imported by the selection core and its tests.

export const WEIGHTING_DIRECTIONS = ["weak_weighted", "strong_weighted"] as const
export type WeightingDirection = (typeof WEIGHTING_DIRECTIONS)[number]

export const DEFAULT_WEIGHTING_DIRECTION: WeightingDirection = "weak_weighted" // Req 2.2
export const WEIGHTING_GAMMA = 1.5 // exponent applied to the (in)mastery base (Req 2.3/2.4)
export const COVERAGE_FLOOR = 1 // questions per Attempted_Topic (Req 4)
export const ZPD_TARGET_ACCURACY = 0.75 // centre of the 70–80% window (Req 5.1)
export const DEFAULT_DIFFICULTY = 3 // mid of 1–5 when accuracy data absent (Req 5.6/5.7)
export const DIFFICULTY_MIN = 1
export const DIFFICULTY_MAX = 5
export const RECENCY_WINDOW_DAYS = 1 // Req 6.4
export const MASTERY_MIN = 0
export const MASTERY_MAX = 100

export const MAX_CHILDREN_PER_PARENT = 3
export const MAX_HELP_PER_SESSION = 5

// Year groups are narrowed to KS2 upper years (4–6) for ApexMaths.
export const YEAR_GROUPS = [4, 5, 6] as const
export type YearGroup = (typeof YEAR_GROUPS)[number]

// Subscription status mirrors Stripe's lifecycle.
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "unpaid",
] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

// A parent has access while trialing or active. past_due / canceled (after period end) block access.
export const ENTITLED_STATUSES: SubscriptionStatus[] = ["trialing", "active"]

export const SESSION_STATUSES = ["active", "completed", "expired", "abandoned"] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

export const MASTERY_CLASSIFICATIONS = ["insufficient_data", "needs_focus", "developing", "strong"] as const
export type MasteryClassification = (typeof MASTERY_CLASSIFICATIONS)[number]

// Minimum graded attempts before a topic can be classified beyond "insufficient_data".
export const MIN_ATTEMPTS_FOR_CLASSIFICATION = 10

// Classify mastery from the number of graded attempts and a score expressed as a fraction in [0, 1].
// Precedence: too few attempts always yields "insufficient_data" regardless of score.
export function classifyMastery(attempts: number, score: number): MasteryClassification {
  if (attempts < MIN_ATTEMPTS_FOR_CLASSIFICATION) return "insufficient_data"
  if (score >= 0.8) return "strong"
  if (score >= 0.5) return "developing"
  return "needs_focus"
}

export const CLASSIFICATION_LABELS: Record<MasteryClassification, string> = {
  insufficient_data: "Not enough data yet",
  needs_focus: "Needs focus",
  developing: "Developing",
  strong: "Strong",
}

// ---- Entity shapes (camelCase, as used in app code) ----

export interface Parent {
  id: string // Cognito sub
  email: string
  guardianAttested: boolean
  ageAttested: boolean
  stripeCustomerId: string | null
  createdAt: string
  deletedAt: string | null
}

export interface Subscription {
  id: string
  parentId: string
  stripeSubscriptionId: string | null
  status: SubscriptionStatus
  priceId: string | null
  currentPeriodEnd: string | null
  trialEnd: string | null
  cancelAtPeriodEnd: boolean
  createdAt: string
  updatedAt: string
}

export interface Child {
  id: string
  parentId: string
  displayName: string
  yearGroup: number | null
  avatarColor: string
  createdAt: string
  deletedAt: string | null
}

export interface Question {
  id: string
  text: string
  options: string[]
  correctIndex: number // SERVER ONLY — never serialised to the client mid-session
  topic: Topic
  difficulty: number
  imageUrl: string | null
  imageDescription: string | null
}

// Safe projection of a question for an active session (no correctIndex).
export interface ClientQuestion {
  id: string
  text: string
  options: string[]
  topic: Topic
  difficulty: number
  imageUrl: string | null
}

export interface PracticeSession {
  id: string
  childId: string
  parentId: string
  type: SessionType
  topic: Topic | null
  questionIds: string[]
  status: SessionStatus
  startedAt: string
  expiresAt: string
  completedAt: string | null
  timeLimitSeconds: number
  helpUsed: number
  score: number | null
  total: number
}

export interface SessionAnswer {
  id: string
  sessionId: string
  questionId: string
  position: number
  selectedIndex: number | null
  isCorrect: boolean | null
  topic: Topic
  answeredAt: string | null
}

export interface TopicProgress {
  childId: string
  topic: Topic
  attempts: number
  correct: number
  masteryScore: number
  classification: MasteryClassification
  updatedAt: string
}

// ---- Per-session summary helpers (pure, no IO) ----

// Aggregate graded answers (isCorrect !== null) into per-topic attempted/correct counts.
// Only topics with at least one graded answer are included. Invariant: correct <= attempted.
export function computePerTopicSummary(
  answers: SessionAnswer[],
): Array<{ topic: Topic; attempted: number; correct: number }> {
  const counts = new Map<Topic, { attempted: number; correct: number }>()

  for (const answer of answers) {
    if (answer.isCorrect === null) continue // skip ungraded answers
    const entry = counts.get(answer.topic) ?? { attempted: 0, correct: 0 }
    entry.attempted += 1
    if (answer.isCorrect === true) entry.correct += 1
    counts.set(answer.topic, entry)
  }

  return Array.from(counts.entries()).map(([topic, { attempted, correct }]) => ({
    topic,
    attempted,
    correct,
  }))
}

// Determine the strongest and weakest topics by correct/attempted ratio.
// Ties are broken alphabetically by topic key. Only topics with >=1 attempt are ranked.
// weakest = "n/a" iff fewer than 2 topics have >=1 attempt (Req 5.3); when 0 topics are
// attempted strongest is also "n/a"; when exactly 1 topic is attempted strongest = that topic.
export function strongestWeakest(
  summary: Array<{ topic: Topic; attempted: number; correct: number }>,
): { strongest: Topic | "n/a"; weakest: Topic | "n/a" } {
  const ranked = summary
    .filter((entry) => entry.attempted >= 1)
    .map((entry) => ({ topic: entry.topic, ratio: entry.correct / entry.attempted }))

  if (ranked.length === 0) {
    return { strongest: "n/a", weakest: "n/a" }
  }

  // Strongest: highest ratio, ties broken alphabetically by topic key.
  const strongest = ranked.reduce((best, current) => {
    if (current.ratio > best.ratio) return current
    if (current.ratio === best.ratio && current.topic < best.topic) return current
    return best
  })

  if (ranked.length < 2) {
    // Only one topic attempted: strongest known, weakest undefined per Req 5.3.
    return { strongest: strongest.topic, weakest: "n/a" }
  }

  // Weakest: lowest ratio, ties broken alphabetically by topic key.
  const weakest = ranked.reduce((worst, current) => {
    if (current.ratio < worst.ratio) return current
    if (current.ratio === worst.ratio && current.topic < worst.topic) return current
    return worst
  })

  return { strongest: strongest.topic, weakest: weakest.topic }
}
