import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider"
import type { LanguageModel } from "ai"

/**
 * Resolves the tutor LLM — **Anthropic Claude Sonnet 4.6**.
 *
 * - On Vercel (production/preview) the request runs against **Amazon Bedrock in
 *   your own AWS account** using **OIDC federation** — Vercel mints a short-lived
 *   token that is exchanged for temporary IAM credentials scoped to AWS_ROLE_ARN.
 *   No long-lived AWS access keys are involved.
 * - Locally, if static AWS keys are present they are used instead (dev convenience).
 * - Otherwise it falls back to the zero-config Vercel AI Gateway model string,
 *   so the feature works during development before AWS is provisioned.
 *
 * Either way the underlying model is Claude Sonnet 4.6.
 */

// Bedrock model id (native) vs AI Gateway slug.
// Claude Sonnet 4.6 is invoked via the *global* cross-Region inference profile
// (there is no eu-only profile); from eu-west-2 (London) requests route to the
// nearest commercial Region automatically. Anthropic dropped the version/date
// suffix starting with Sonnet 4.6, so the ids are simply `…claude-sonnet-4-6`.
const BEDROCK_MODEL_ID = "global.anthropic.claude-sonnet-4-6"
const GATEWAY_MODEL_ID = "anthropic/claude-sonnet-4.6"

function region(): string | undefined {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION
}

export function isBedrockConfigured(): boolean {
  if (!region()) return false
  // OIDC role (preferred) or static keys (local dev).
  if (process.env.AWS_ROLE_ARN) return true
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
}

export function tutorModel(): LanguageModel {
  if (isBedrockConfigured()) {
    const roleArn = process.env.AWS_ROLE_ARN
    const bedrock = createAmazonBedrock(
      roleArn
        ? {
            region: region(),
            // OIDC federation: temporary credentials assumed from the role.
            credentialProvider: awsCredentialsProvider({ roleArn }),
          }
        : {
            region: region(),
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            sessionToken: process.env.AWS_SESSION_TOKEN,
          },
    )
    return bedrock(BEDROCK_MODEL_ID)
  }
  // Gateway fallback (string model id is resolved by the AI SDK Gateway).
  return GATEWAY_MODEL_ID as unknown as LanguageModel
}

/** Human-readable execution source for logging / debugging. */
export function tutorModelSource(): "bedrock" | "gateway" {
  return isBedrockConfigured() ? "bedrock" : "gateway"
}
