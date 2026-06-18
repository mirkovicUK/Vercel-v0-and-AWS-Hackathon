"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * While the post-session review is still being generated in the background
 * (status === "pending"), poll the server by calling router.refresh() on an
 * interval. As soon as the background `after()` work finalises the report to
 * "complete", the next refresh renders the AI explanations and this component
 * unmounts. Bounded by `maxTries` so it never polls forever.
 */
export function PendingAutoRefresh({ intervalMs = 2500, maxTries = 12 }: { intervalMs?: number; maxTries?: number }) {
  const router = useRouter()
  useEffect(() => {
    let tries = 0
    const id = setInterval(() => {
      tries += 1
      router.refresh()
      if (tries >= maxTries) clearInterval(id)
    }, intervalMs)
    return () => clearInterval(id)
  }, [router, intervalMs, maxTries])
  return null
}
