import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider"
import type { LanguageModel } from "ai"

/**
 * Single source of truth for the app's LLM.
 *
 * The WHOLE app — interactive tutoring hints, per-session review, AND the parent
 * progress report — runs on ONE model: Claude Sonnet 4.6. There is exactly one
 * place the model id is defined (below) and one accessor (`appModel`), so there
 * is no chance of the three call sites drifting onto different models.
 *
 * Resolution (Amazon Bedrock via OIDC federation):
 * - On Vercel (prod/preview), requests hit Bedrock in our own AWS account using
 *   OIDC — Vercel mints a short-lived token exchanged for temporary IAM creds
 *   scoped to AWS_ROLE_ARN. No long-lived access keys.
 * - Locally, static AWS keys are used if present (dev convenience).
 * - Otherwise it falls back to the zero-config Vercel AI Gateway model string.
 *
 * Why Sonnet (not Haiku): Sonnet conforms reliably to the structured report
 * schema where Haiku did not, and powers the tutoring/review quality.
 *
 * Why the `eu.` regional inference profile (not `global.`): our Vercel functions
 * and Bedrock both run in London (eu-west-2). The EU profile keeps inference
 * in-region (load-balanced across EU Regions) instead of routing to a distant
 * commercial Region, which roughly halved time-to-first-token in measurement.
 */

// --- THE model. One id, one fallback. Change here and the whole app follows. ---
const APP_BEDROCK_MODEL_ID = "eu.anthropic.claude-sonnet-4-6"
const APP_GATEWAY_MODEL_ID = "anthropic/claude-sonnet-4.6"

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

/**
 * The app's language model — used everywhere (hints, review, parent report).
 * This is the ONLY model accessor; there are deliberately no per-feature
 * variants because every feature uses the same Sonnet 4.6 model.
 */
export function appModel(): LanguageModel {
  if (isBedrockConfigured()) return bedrockProvider()(APP_BEDROCK_MODEL_ID)
  // Gateway fallback (string model id is resolved by the AI SDK Gateway).
  return APP_GATEWAY_MODEL_ID as unknown as LanguageModel
}

/** Human-readable execution source for logging / debugging. */
export function appModelSource(): "bedrock" | "gateway" {
  return isBedrockConfigured() ? "bedrock" : "gateway"
}
