"use client"

import { useActionState } from "react"
import Link from "next/link"
import { signInAction, verifyAction, resendAction, type ActionState } from "@/app/(auth)/actions"
import { SubmitButton } from "@/components/auth/submit-button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { AlertCircle, MailCheck } from "lucide-react"

const initial: ActionState = { ok: false }

export function SignInForm() {
  const [state, action] = useActionState(signInAction, initial)

  // If the account exists but isn't verified yet, sign-in returns the verify
  // step (with a fresh code already sent) so the user isn't stuck.
  if (state.ok && state.step === "verify" && state.email) {
    return <VerifyStep email={state.email} />
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email address</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Forgot password?
          </Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <SubmitButton className="mt-1 w-full" pendingText="Signing in...">
        Sign in
      </SubmitButton>
    </form>
  )
}

function VerifyStep({ email }: { email: string }) {
  const [state, action] = useActionState(verifyAction, initial)
  const [resendState, resend] = useActionState(resendAction, initial)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-3">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-success" />
        <p className="text-sm text-foreground">
          Please verify your email first. We sent a 6-digit code to{" "}
          <span className="font-semibold">{email}</span>. Enter it below to finish setting up your account.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-4" noValidate>
        {state.error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{state.error}</span>
          </div>
        ) : null}
        <input type="hidden" name="email" value={email} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">Verification code</Label>
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required placeholder="123456" />
        </div>
        <SubmitButton className="w-full" pendingText="Verifying...">
          Verify email
        </SubmitButton>
      </form>

      <form action={resend} className="text-center">
        <input type="hidden" name="email" value={email} />
        {resendState.ok ? (
          <p className="text-xs text-success">A new code is on its way.</p>
        ) : (
          <button
            type="submit"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Didn&apos;t get it? Resend code
          </button>
        )}
      </form>
    </div>
  )
}
