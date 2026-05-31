/**
 * Source of truth for the subscription plan. Prices are validated server-side;
 * the client may only choose a plan id, never set a price.
 */
export interface Plan {
  id: string
  name: string
  description: string
  priceInPence: number // GBP minor units
  currency: "gbp"
  interval: "month"
  trialDays: number
  features: string[]
}

export const PLAN: Plan = {
  id: "apex-family-monthly",
  name: "Apex Family",
  description: "Unlimited 11+ maths practice for up to 3 children, with AI help and parent reports.",
  priceInPence: 999, // £9.99 / month
  currency: "gbp",
  interval: "month",
  trialDays: 14,
  features: [
    "Up to 3 child profiles",
    "Unlimited timed practice sessions",
    "AI “Show me how” step-by-step tutor",
    "Per-topic progress tracking & focus areas",
    "AI parent review reports",
    "Cancel any time",
  ],
}

export function formatPrice(pence: number, currency = "gbp"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(pence / 100)
}
