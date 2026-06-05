"use server"

import { z } from "zod"
import { redirect } from "next/navigation"
import {
  signUp,
  confirmSignUp,
  resendCode,
  signIn,
  forgotPassword,
  confirmForgotPassword,
  globalSignOut,
  isCognitoConfigured,
} from "@/lib/auth/cognito"
import {
  setSessionCookies,
  clearSessionCookies,
  getAccessToken,
  getCurrentParent,
} from "@/lib/auth/session"
import { setAttestations } from "@/lib/db/parents"
import { audit } from "@/lib/db/audit"

export interface ActionState {
  ok: boolean
  error?: string
  /** Used by the sign-up form to advance to the verification step. */
  step?: "verify"
  email?: string
}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.")
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .regex(/[a-z]/, "Include a lowercase letter.")
  .regex(/[A-Z]/, "Include an uppercase letter.")
  .regex(/[0-9]/, "Include a number.")

function configError(): ActionState {
  return {
    ok: false,
    error: "Authentication isn't configured yet. Add your Cognito environment variables to continue.",
  }
}

function friendlyCognitoError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? ""
  const message = (err as { message?: string })?.message ?? ""
  // Log the real error to the server (Vercel function logs) for diagnosis.
  // Never shown to the user; safe — contains no secrets.
  console.error("[auth] Cognito error:", JSON.stringify({ name, message }))
  switch (name) {
    case "UsernameExistsException":
      return "An account with that email already exists. Try signing in instead."
    case "NotAuthorizedException":
      return "Incorrect email or password."
    case "UserNotConfirmedException":
      return "Please verify your email before signing in."
    case "CodeMismatchException":
      return "That verification code is incorrect. Please check and try again."
    case "ExpiredCodeException":
      return "That code has expired. Request a new one."
    case "LimitExceededException":
      return "Too many attempts. Please wait a moment and try again."
    case "InvalidPasswordException":
      return "That password doesn't meet the requirements."
    case "UserNotFoundException":
      return "Incorrect email or password."
    default:
      // Temporary diagnostic: surface the real error name so we can see the
      // actual cause. Safe — error names contain no secrets. Remove once fixed.
      return `Something went wrong${name ? ` (${name})` : ""}. Please try again.`
  }
}

export async function signUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isCognitoConfigured()) return configError()
  const parsed = z
    .object({ email: emailSchema, password: passwordSchema })
    .safeParse({ email: formData.get("email"), password: formData.get("password") })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid details." }
  }
  try {
    await signUp(parsed.data.email, parsed.data.password)
    // NOTE: we do NOT create the Aurora parent row here. The account is not yet
    // verified, and creating it now would persist orphan rows for accounts that
    // never confirm — and couple sign-up to a DB write that can fail. The parent
    // row is created lazily on the first authenticated visit (see getCurrentParent
    // in lib/auth/session.ts), i.e. only after the user has verified and signed in.
    await audit({ action: "auth.signup", detail: { email: parsed.data.email } })
    return { ok: true, step: "verify", email: parsed.data.email }
  } catch (err) {
    // The email already has an account. We deliberately do NOT resend a code here:
    // the client flow can't tell a CONFIRMED account from an UNCONFIRMED one, so
    // resending would email a code to already-verified users (it looks like a
    // second sign-up). Instead we point them to sign in. The unconfirmed-recovery
    // lives on the sign-in path (signInAction handles UserNotConfirmedException by
    // resending a code and showing the verify step), where the user proves intent
    // with their password.
    if ((err as { name?: string })?.name === "UsernameExistsException") {
      return {
        ok: false,
        error: "An account with that email already exists. Please sign in instead.",
      }
    }
    return { ok: false, error: friendlyCognitoError(err) }
  }
}

export async function verifyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isCognitoConfigured()) return configError()
  const parsed = z
    .object({ email: emailSchema, code: z.string().trim().min(4, "Enter the code from your email.") })
    .safeParse({ email: formData.get("email"), code: formData.get("code") })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid code." }
  }
  try {
    await confirmSignUp(parsed.data.email, parsed.data.code)
    await audit({ action: "auth.verified", detail: { email: parsed.data.email } })
  } catch (err) {
    return { ok: false, error: friendlyCognitoError(err) }
  }
  redirect("/sign-in?verified=1")
}

export async function resendAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isCognitoConfigured()) return configError()
  const email = emailSchema.safeParse(formData.get("email"))
  if (!email.success) return { ok: false, error: "Enter a valid email address." }
  try {
    await resendCode(email.data)
    return { ok: true, step: "verify", email: email.data }
  } catch (err) {
    return { ok: false, error: friendlyCognitoError(err) }
  }
}

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isCognitoConfigured()) return configError()
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1, "Enter your password.") })
    .safeParse({ email: formData.get("email"), password: formData.get("password") })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid details." }
  }
  try {
    const tokens = await signIn(parsed.data.email, parsed.data.password)
    await setSessionCookies(tokens, parsed.data.email)
    await audit({ action: "auth.signin", detail: { email: parsed.data.email } })
  } catch (err) {
    // If the account exists but was never verified, send the user to the verify
    // step (with a fresh code) instead of a dead-end error. This recovers the
    // common "signed up, closed the tab before entering the code" case.
    if ((err as { name?: string })?.name === "UserNotConfirmedException") {
      await resendCode(parsed.data.email).catch(() => undefined)
      return { ok: true, step: "verify", email: parsed.data.email }
    }
    return { ok: false, error: friendlyCognitoError(err) }
  }
  redirect("/dashboard")
}

export async function forgotPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isCognitoConfigured()) return configError()
  const email = emailSchema.safeParse(formData.get("email"))
  if (!email.success) return { ok: false, error: "Enter a valid email address." }
  try {
    await forgotPassword(email.data)
    return { ok: true, step: "verify", email: email.data }
  } catch (err) {
    return { ok: false, error: friendlyCognitoError(err) }
  }
}

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isCognitoConfigured()) return configError()
  const parsed = z
    .object({
      email: emailSchema,
      code: z.string().trim().min(4, "Enter the code from your email."),
      password: passwordSchema,
    })
    .safeParse({
      email: formData.get("email"),
      code: formData.get("code"),
      password: formData.get("password"),
    })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid details." }
  }
  try {
    await confirmForgotPassword(parsed.data.email, parsed.data.code, parsed.data.password)
  } catch (err) {
    return { ok: false, error: friendlyCognitoError(err) }
  }
  redirect("/sign-in?reset=1")
}

export async function completeOnboardingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parent = await getCurrentParent()
  if (!parent) redirect("/sign-in")
  const guardian = formData.get("guardian") === "on"
  const age = formData.get("age") === "on"
  if (!guardian || !age) {
    return { ok: false, error: "Please confirm both statements to continue." }
  }
  await setAttestations(parent.id)
  await audit({ action: "onboarding.completed", parentId: parent.id })
  redirect("/dashboard")
}

export async function signOutAction(): Promise<void> {
  const token = await getAccessToken()
  if (token) await globalSignOut(token)
  await clearSessionCookies()
  redirect("/")
}
