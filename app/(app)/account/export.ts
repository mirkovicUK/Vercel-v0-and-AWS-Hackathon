import type { Parent, Child, Subscription, PracticeSession, SessionAnswer, TopicProgress } from "@/lib/domain"

export interface ChildExport {
  child: Child
  progress: TopicProgress[]
  sessions: (PracticeSession & { answers: SessionAnswer[] })[]
}

export interface DataExport {
  exportedAt: string
  format: string
  account: {
    id: string
    email: string
    guardianAttested: boolean
    ageAttested: boolean
    createdAt: string
  }
  subscription: Subscription | null
  children: ChildExport[]
}

/** Shape the full account export. Pure function so it can be unit-tested. */
export function buildExport(
  parent: Parent,
  subscription: Subscription | null,
  children: ChildExport[],
): DataExport {
  return {
    exportedAt: new Date().toISOString(),
    format: "apex-data-export-v1",
    account: {
      id: parent.id,
      email: parent.email,
      guardianAttested: parent.guardianAttested,
      ageAttested: parent.ageAttested,
      createdAt: parent.createdAt,
    },
    subscription,
    children,
  }
}
