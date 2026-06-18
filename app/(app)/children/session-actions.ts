"use server"

import { requireOnboardedParent } from "@/lib/auth/guard"
import { getSessionDetail, type SessionDetail } from "@/lib/db/session-detail"

/**
 * Load one past session's full detail for the click-through dialog. Read-only,
 * scoped to the authenticated parent. Returns null if the session isn't theirs.
 */
export async function getSessionDetailAction(sessionId: string): Promise<SessionDetail | null> {
  const parent = await requireOnboardedParent()
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 64) return null
  return getSessionDetail(sessionId, parent.id)
}
