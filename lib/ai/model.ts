import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import type { LanguageModel } from "ai"

/**
 * Resolves the Amazon Nova 2 Lite model.
 *
 * - If AWS credentials are configured, the request runs against **Amazon Bedrock
 *   in your own AWS account** (billed to you, in your region) via `@ai-sdk/amazon-bedrock`.
 * - Otherwise it falls back to the zero-config Vercel AI Gateway model string,
 *   so the feature works during development before AWS is provisioned.
 *
 * Either way the underlying model is Amazon Nova 2 Lite.
 */

// Bedrock model id (native) vs AI Gateway slug.
// Nova 2 is invoked via an inference profile. From eu-west-2 (London) we use the
// `global.` profile, since there is no eu-region Nova 2 Lite profile.
const BEDROCK_MODEL_ID = "global.amazon.nova-2-lite-v1:0"
const GATEWAY_MODEL_ID = "amazon/nova-2-lite"

export function isBedrockConfigured(): boolean {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION),
  )
}

export function novaModel(): LanguageModel {
  if (isBedrockConfigured()) {
    const bedrock = createAmazonBedrock({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    })
    return bedrock(BEDROCK_MODEL_ID)
  }
  // Gateway fallback (string model id is resolved by the AI SDK Gateway).
  return GATEWAY_MODEL_ID as unknown as LanguageModel
}

/** Human-readable source for logging / debugging. */
export function novaSource(): "bedrock" | "gateway" {
  return isBedrockConfigured() ? "bedrock" : "gateway"
}
