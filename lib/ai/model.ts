import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider"
import type { LanguageModel } from "ai"

/**
 * Resolves the app's LLMs on **Amazon Bedrock** via **OIDC federation**.
 *
 * - On Vercel (production/preview) requests run against Bedrock in your own AWS
 *   account using OIDC — Vercel mints a short-lived token exchanged for temporary
 *   IAM credentials scoped to AWS_ROLE_ARN. No long-lived access keys.
 * - Locally, static AWS keys are used if present (dev convenience).
 * - Otherwise it falls back to the zero-config Vercel AI Gateway model string.
 *
 * Model choice:
 * - **Claude Sonnet 4.6** powers everything — interactive tutoring (hints),
 *   per-session review, AND the parent progress report.
 *
 * We trialled Haiku 4.5 for the report (cheaper/faster per token) but it was
 * unreliable at conforming to the structured report schema. Sonnet conforms
 * reliably, and because the report is STREAMED (streamObject), fields appear
 * progressively — which hides Sonnet's lower per-token throughput and keeps the
 * UX snappy. Reliability + good UX beats raw token speed here.
 *
 * Sonnet is invoked via its *global* cross-Region inference profile (from
 * eu-west-2 the request routes to the nearest commercial Region automatically).
 */

const TUTOR_BEDROCK_MODEL_ID = "global.anthropic.claude-sonnet-4-6"
const TUTOR_GATEWAY_MODEL_ID = "anthropic/claude-sonnet-4.6"

function region(): string | undefined {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION
}

export function isBedrockConfigured(): boolean {
  if (!region()) return false
  // OIDC role (preferred) or static keys (local dev).
  if (process.env.AWS_ROLE_ARN) return true
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
}

/** Build a Bedrock provider using OIDC creds (or static keys locally). */
function bedrockProvider() {
  const roleArn = process.env.AWS_ROLE_ARN
  return createAmazonBedrock(
    roleArn
      ? { region: region(), credentialProvider: awsCredentialsProvider({ roleArn }) }
      : {
          region: region(),
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          sessionToken: process.env.AWS_SESSION_TOKEN,
        },
  )
}

function resolveModel(bedrockId: string, gatewayId: string): LanguageModel {
  if (isBedrockConfigured()) return bedrockProvider()(bedrockId)
  // Gateway fallback (string model id is resolved by the AI SDK Gateway).
  return gatewayId as unknown as LanguageModel
}

/** Sonnet 4.6 — tutoring hints and per-session review. */
export function tutorModel(): LanguageModel {
  return resolveModel(TUTOR_BEDROCK_MODEL_ID, TUTOR_GATEWAY_MODEL_ID)
}

/**
 * Parent progress report. Uses Sonnet 4.6 (same as the tutor): it conforms to
 * the structured report schema far more reliably than Haiku, and we stream it
 * so the latency is hidden behind progressive rendering.
 */
export function reportModel(): LanguageModel {
  return resolveModel(TUTOR_BEDROCK_MODEL_ID, TUTOR_GATEWAY_MODEL_ID)
}

/** Human-readable execution source for logging / debugging. */
export function tutorModelSource(): "bedrock" | "gateway" {
  return isBedrockConfigured() ? "bedrock" : "gateway"
}
