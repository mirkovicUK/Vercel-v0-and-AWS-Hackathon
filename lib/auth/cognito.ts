import "server-only"
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  GlobalSignOutCommand,
  type AuthenticationResultType,
} from "@aws-sdk/client-cognito-identity-provider"
import { createHmac } from "node:crypto"

/**
 * Amazon Cognito wrapper. Cognito owns identity (signup, email verification,
 * passwords, sessions/JWTs). Our Aurora `parents` row is keyed by the Cognito
 * `sub`. We use the USER_PASSWORD_AUTH flow with our own branded forms rather
 * than the Hosted UI, so the experience stays inside the app.
 */

export interface CognitoConfig {
  region: string
  userPoolId: string
  clientId: string
  clientSecret?: string
}

export function getCognitoConfig(): CognitoConfig {
  const userPoolId = process.env.COGNITO_USER_POOL_ID
  const clientId = process.env.COGNITO_CLIENT_ID
  const clientSecret = process.env.COGNITO_CLIENT_SECRET
  if (!userPoolId || !clientId) {
    throw new Error("Cognito is not configured. Set COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID.")
  }
  // A Cognito user pool id is "<region>_<id>" (e.g. "eu-west-2_DWGwRtfrk"), so the
  // region is derivable from it. Prefer that — it cannot be wrong and is immune to
  // the AWS_REGION that Vercel's runtime injects for its own Lambda region.
  const regionFromPool = userPoolId.includes("_") ? userPoolId.split("_")[0] : undefined
  const region =
    regionFromPool ?? process.env.COGNITO_REGION ?? process.env.AWS_REGION ?? "eu-west-2"
  return { region, userPoolId, clientId, clientSecret }
}

export function isCognitoConfigured(): boolean {
  return Boolean(process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID)
}

let cached: CognitoIdentityProviderClient | null = null
function client(region: string): CognitoIdentityProviderClient {
  if (!cached) cached = new CognitoIdentityProviderClient({ region })
  return cached
}

/** SECRET_HASH is required when the app client has a secret. */
function secretHash(username: string, cfg: CognitoConfig): string | undefined {
  if (!cfg.clientSecret) return undefined
  return createHmac("sha256", cfg.clientSecret)
    .update(username + cfg.clientId)
    .digest("base64")
}

export interface AuthTokens {
  idToken: string
  accessToken: string
  refreshToken?: string
  expiresIn: number
}

function mapTokens(r: AuthenticationResultType | undefined): AuthTokens {
  if (!r?.IdToken || !r.AccessToken) throw new Error("Cognito returned no tokens")
  return {
    idToken: r.IdToken,
    accessToken: r.AccessToken,
    refreshToken: r.RefreshToken,
    expiresIn: r.ExpiresIn ?? 3600,
  }
}

export async function signUp(email: string, password: string): Promise<{ userSub: string; confirmed: boolean }> {
  const cfg = getCognitoConfig()
  const res = await client(cfg.region).send(
    new SignUpCommand({
      ClientId: cfg.clientId,
      Username: email,
      Password: password,
      SecretHash: secretHash(email, cfg),
      UserAttributes: [{ Name: "email", Value: email }],
    }),
  )
  return { userSub: res.UserSub!, confirmed: Boolean(res.UserConfirmed) }
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  const cfg = getCognitoConfig()
  await client(cfg.region).send(
    new ConfirmSignUpCommand({
      ClientId: cfg.clientId,
      Username: email,
      ConfirmationCode: code,
      SecretHash: secretHash(email, cfg),
    }),
  )
}

export async function resendCode(email: string): Promise<void> {
  const cfg = getCognitoConfig()
  await client(cfg.region).send(
    new ResendConfirmationCodeCommand({
      ClientId: cfg.clientId,
      Username: email,
      SecretHash: secretHash(email, cfg),
    }),
  )
}

export async function signIn(email: string, password: string): Promise<AuthTokens> {
  const cfg = getCognitoConfig()
  const res = await client(cfg.region).send(
    new InitiateAuthCommand({
      ClientId: cfg.clientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
        ...(cfg.clientSecret ? { SECRET_HASH: secretHash(email, cfg)! } : {}),
      },
    }),
  )
  return mapTokens(res.AuthenticationResult)
}

export async function refreshTokens(refreshToken: string, username: string): Promise<AuthTokens> {
  const cfg = getCognitoConfig()
  const res = await client(cfg.region).send(
    new InitiateAuthCommand({
      ClientId: cfg.clientId,
      AuthFlow: "REFRESH_TOKEN_AUTH",
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
        ...(cfg.clientSecret ? { SECRET_HASH: secretHash(username, cfg)! } : {}),
      },
    }),
  )
  const tokens = mapTokens(res.AuthenticationResult)
  return { ...tokens, refreshToken } // refresh token is not re-issued
}

export async function forgotPassword(email: string): Promise<void> {
  const cfg = getCognitoConfig()
  await client(cfg.region).send(
    new ForgotPasswordCommand({
      ClientId: cfg.clientId,
      Username: email,
      SecretHash: secretHash(email, cfg),
    }),
  )
}

export async function confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void> {
  const cfg = getCognitoConfig()
  await client(cfg.region).send(
    new ConfirmForgotPasswordCommand({
      ClientId: cfg.clientId,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword,
      SecretHash: secretHash(email, cfg),
    }),
  )
}

export async function globalSignOut(accessToken: string): Promise<void> {
  const cfg = getCognitoConfig()
  await client(cfg.region)
    .send(new GlobalSignOutCommand({ AccessToken: accessToken }))
    .catch(() => undefined)
}
