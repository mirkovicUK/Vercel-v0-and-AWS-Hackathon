import "server-only"
import Stripe from "stripe"

if (!process.env.STRIPE_SECRET_KEY) {
  // Surfaced at call sites with a friendly message; never throw at import time in dev.
  console.log("[v0] STRIPE_SECRET_KEY is not set — billing actions will be unavailable.")
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  // Pin the API version for predictable webhook payloads (matches installed SDK).
  apiVersion: "2026-05-27.dahlia",
  appInfo: { name: "Apex 11+ Maths" },
})

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}
