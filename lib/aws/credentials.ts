import "server-only"
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider"

// The credential-provider type is derived from the provider library itself
// (`ReturnType<typeof awsCredentialsProvider>`) rather than importing it from
// `@aws-sdk/types`, which isn't a direct dependency. This stays accurate to the
// exact type the SDK clients expect, with no extra package to install.
type CredentialProvider = ReturnType<typeof awsCredentialsProvider>

/**
 * Resolves AWS credentials for the server runtime.
 *
 * Production / preview (on Vercel): we use **OIDC federation**. Vercel mints a
 * short-lived OIDC token for the deployment; `awsCredentialsProvider` exchanges
 * it (via sts:AssumeRoleWithWebIdentity) for temporary IAM credentials scoped to
 * the role in AWS_ROLE_ARN. No long-lived AWS access keys are stored anywhere.
 *
 * Local development: AWS_ROLE_ARN is unset, so we return `undefined` and let the
 * AWS SDK fall back to its default provider chain (an AWS profile, SSO, or
 * AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in `.env.local`).
 *
 * Pass the result straight to an SDK client's `credentials` option; passing
 * `undefined` is equivalent to not setting it, so the default chain applies.
 */
export function awsCredentials(): CredentialProvider | undefined {
  const roleArn = process.env.AWS_ROLE_ARN
  if (!roleArn) return undefined
  return awsCredentialsProvider({ roleArn })
}

/** True when AWS access is configured by either OIDC (role) or static keys. */
export function isAwsConfigured(): boolean {
  return Boolean(
    process.env.AWS_ROLE_ARN ||
      (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
  )
}
