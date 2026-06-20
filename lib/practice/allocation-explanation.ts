/**
 * Allocation explainability helpers (PURE).
 *
 * Produces the parent-facing Allocation_Explanation for an adaptive session:
 * a human-readable description of how the session was split across topics
 * (e.g. "5 Geometry, 4 Fractions, Decimals & Percentages"). It works purely
 * from per-topic question counts and topic display labels, so the output
 * contains ONLY topic names and integer counts — never any identifier or
 * personal data (Requirement 9.5).
 *
 * This module is intentionally PURE: it performs no I/O and imports nothing
 * from `server-only`, the database, or `next/*`. The calibrating note is a
 * separate concern rendered by the page; this module is calibrating-agnostic.
 * (Requirements 9.1, 9.2, 9.5)
 */
import { TOPICS, TOPIC_LABELS, type Topic } from "@/lib/domain"

/**
 * Reconstruct the per-topic allocation (the count selected per Topic) from the
 * session's ordered list of question topics. Every one of the six topics is
 * present in the returned record, zero-filled, so callers can rely on a total
 * shape. (Requirement 9.1)
 */
export function allocationFromTopics(topics: Topic[]): Record<Topic, number> {
  const allocation = Object.fromEntries(TOPICS.map((t) => [t, 0])) as Record<Topic, number>
  for (const topic of topics) {
    // Guard against an unexpected value not in the topic enum.
    if (topic in allocation) allocation[topic] += 1
  }
  return allocation
}

/**
 * Format the Allocation_Explanation: list each Topic with a non-zero count and
 * its question count, ordered by descending count, ties broken deterministically
 * by the fixed topic order (the TOPICS array order). Each entry is rendered as
 * "<count> <TOPIC_LABELS[topic]>" and entries are joined by ", ".
 *
 * An empty or all-zero allocation yields an empty string. (Requirement 9.2, 9.5)
 */
export function formatAllocationExplanation(allocation: Record<Topic, number>): string {
  return TOPICS
    .filter((topic) => (allocation[topic] ?? 0) > 0)
    .sort((a, b) => {
      const diff = allocation[b] - allocation[a]
      if (diff !== 0) return diff // descending by count
      return TOPICS.indexOf(a) - TOPICS.indexOf(b) // ties: fixed topic order
    })
    .map((topic) => `${allocation[topic]} ${TOPIC_LABELS[topic]}`)
    .join(", ")
}
