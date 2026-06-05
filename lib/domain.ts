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

export const SESSION_TYPES = ["warmup", "topic", "mock"] as const
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
}

export const MAX_CHILDREN_PER_PARENT = 3
export const MAX_HELP_PER_SESSION = 5

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

export const MASTERY_CLASSIFICATIONS = ["needs_focus", "developing", "strong"] as const
export type MasteryClassification = (typeof MASTERY_CLASSIFICATIONS)[number]

export function classifyMastery(masteryScore: number): MasteryClassification {
  if (masteryScore >= 75) return "strong"
  if (masteryScore >= 50) return "developing"
  return "needs_focus"
}

export const CLASSIFICATION_LABELS: Record<MasteryClassification, string> = {
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
