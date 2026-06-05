import "server-only"
import Stripe from "stripe"

if (!process.env.STRIPE_SECRET_KEY) {
  // Surfaced at call sites with a friendly message; never throw at import time.
  console.log("[v0] STRIPE_SECRET_KEY is not set — billing actions will be unavailable.")
}

/**
 * Lazily constructed Stripe client.
 *
 * The Stripe SDK throws at construction time if no API key is present. During a
 * production build (and in any environment where STRIPE_SECRET_KEY is unset),
 * modules like the webhook route are evaluated without secrets — so we must NOT
 * build the client at import time. Instead we create it on first use and cache
 * it. A Proxy keeps every existing `stripe.foo()` call site working unchanged.
 */
let cached: Stripe | null = null

function getStripe(): Stripe {
  if (cached) return cached
  const apiKey = process.env.STRIPE_SECRET_KEY
  if (!apiKey) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY to enable billing.")
  }
  cached = new Stripe(apiKey, {
    // Pin the API version for predictable webhook payloads (matches installed SDK).
    apiVersion: "2026-05-27.dahlia",
    appInfo: { name: "ApexMaths" },
  })
  return cached
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getStripe()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === "function" ? value.bind(client) : value
  },
}) as Stripe

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}
