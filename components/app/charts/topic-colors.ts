import type { Topic } from "@/lib/domain"

/** Stable, visually distinct colour per topic, shared across all charts. */
export const TOPIC_COLORS: Record<Topic, string> = {
  number: "#2e73b8",
  fractions_decimals_percentages: "#8b5cf6",
  ratio_proportion: "#0d9488",
  algebra: "#f59e0b",
  geometry: "#ef4444",
  data_handling: "#10b981",
}

export const RESULT_COLORS = {
  correct: "#10b981",
  wrong: "#ef4444",
  skipped: "#cbd5e1",
}
