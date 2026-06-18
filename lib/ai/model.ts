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
 * Two models, picked per job:
 * - **Claude Sonnet 4.6** — interactive tutoring (hints) + per-session review.
 * - **Claude Haiku 4.5** — the parent progress report: short, templated
 *   summarisation where Haiku's higher throughput makes it much faster/cheaper.
 *
 * Both are invoked via their *global* cross-Region inference profile (from
 * eu-west-2 the request routes to the nearest commercial Region automatically).
 */

const TUTOR_BEDROCK_MODEL_ID = "global.anthropic.claude-sonnet-4-6"
const TUTOR_GATEWAY_MODEL_ID = "anthropic/claude-sonnet-4.6"

const REPORT_BEDROCK_MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
const REPORT_GATEWAY_MODEL_ID = "anthropic/claude-haiku-4.5"

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

/** Haiku 4.5 — fast, cheap parent progress report. */
export function reportModel(): LanguageModel {
  return resolveModel(REPORT_BEDROCK_MODEL_ID, REPORT_GATEWAY_MODEL_ID)
}

/** Human-readable execution source for logging / debugging. */
export function tutorModelSource(): "bedrock" | "gateway" {
  return isBedrockConfigured() ? "bedrock" : "gateway"
}
