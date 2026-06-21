import "server-only"
import { cookies } from "next/headers"
import { CognitoJwtVerifier } from "aws-jwt-verify"
import { getCognitoConfig, isCognitoConfigured, refreshTokens, type AuthTokens } from "@/lib/auth/cognito"
import { getParentById, upsertParent } from "@/lib/db/parents"
import type { Parent } from "@/lib/domain"

const ID_COOKIE = "apex_id"
const ACCESS_COOKIE = "apex_at"
const REFRESH_COOKIE = "apex_rt"
const EMAIL_COOKIE = "apex_email"

const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
}

// Cache verifier instances per process.
let idVerifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null
function getIdVerifier() {
  const cfg = getCognitoConfig()
  if (!idVerifier) {
    idVerifier = CognitoJwtVerifier.create({
      userPoolId: cfg.userPoolId,
      tokenUse: "id",
      clientId: cfg.clientId,
    })
  }
  return idVerifier
}

export interface IdClaims {
  sub: string
  email: string
  groups: string[]
}

/** The Cognito user-pool group that grants admin access. */
const ADMIN_GROUP = "admins"

/**
 * Normalize the raw `cognito:groups` claim into a string list. Depending on
 * pool configuration the claim can arrive as a `string[]`, a single `string`,
 * or be absent — this always returns an array.
 */
function readGroups(payload: Record<string, unknown>): string[] {
  const raw = payload["cognito:groups"]
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === "string" && raw.length > 0) return [raw]
  return []
}

/** Pure predicate: true iff the claims carry membership of the admins group. */
export function isAdminClaims(claims: IdClaims | null): boolean {
  return claims !== null && claims.groups.includes(ADMIN_GROUP)
}

/** Persist tokens to httpOnly cookies after a successful sign-in. */
export async function setSessionCookies(tokens: AuthTokens, email: string): Promise<void> {
  const jar = await cookies()
  // 30 days for refresh; short-lived for id/access (refreshed on demand).
  jar.set(ID_COOKIE, tokens.idToken, { ...cookieOpts, maxAge: tokens.expiresIn })
  jar.set(ACCESS_COOKIE, tokens.accessToken, { ...cookieOpts, maxAge: tokens.expiresIn })
  jar.set(EMAIL_COOKIE, email, { ...cookieOpts, maxAge: 60 * 60 * 24 * 30 })
  if (tokens.refreshToken) {
    jar.set(REFRESH_COOKIE, tokens.refreshToken, { ...cookieOpts, maxAge: 60 * 60 * 24 * 30 })
  }
}

export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies()
  for (const name of [ID_COOKIE, ACCESS_COOKIE, REFRESH_COOKIE, EMAIL_COOKIE]) {
    jar.delete(name)
  }
}

export async function getAccessToken(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(ACCESS_COOKIE)?.value ?? null
}

/**
 * Verify the current id token and return its claims, transparently refreshing
 * with the refresh token if the id token has expired. Returns null when there
 * is no valid session.
 */
async function getVerifiedClaims(): Promise<IdClaims | null> {
  if (!isCognitoConfigured()) return null
  const jar = await cookies()
  const idToken = jar.get(ID_COOKIE)?.value
  const verifier = getIdVerifier()

  if (idToken) {
    try {
      const payload = await verifier.verify(idToken)
      return { sub: payload.sub, email: String(payload.email ?? ""), groups: readGroups(payload) }
    } catch {
      // fall through to refresh
    }
  }

  const refreshToken = jar.get(REFRESH_COOKIE)?.value
  const email = jar.get(EMAIL_COOKIE)?.value
  if (!refreshToken || !email) return null
  try {
    const refreshed = await refreshTokens(refreshToken, email)
    await setSessionCookies(refreshed, email)
    const payload = await verifier.verify(refreshed.idToken)
    return { sub: payload.sub, email: String(payload.email ?? email), groups: readGroups(payload) }
  } catch {
    return null
  }
}

/**
 * The authenticated parent for the current request, or null. Lazily ensures a
 * matching `parents` row exists in Aurora (keyed by Cognito sub).
 */
export async function getCurrentParent(): Promise<Parent | null> {
  const claims = await getVerifiedClaims()
  if (!claims) return null
  const existing = await getParentById(claims.sub)
  if (existing) return existing
  // First authenticated visit after verification — create the row.
  return upsertParent({ id: claims.sub, email: claims.email })
}

/** Like getCurrentParent but only reads (does not create) — for lightweight checks. */
export async function getCurrentClaims(): Promise<IdClaims | null> {
  return getVerifiedClaims()
}
