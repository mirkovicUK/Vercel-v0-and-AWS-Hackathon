"use client"

import { useActionState } from "react"
import { forgotPasswordAction, resetPasswordAction, type ActionState } from "@/app/(auth)/actions"
import { SubmitButton } from "@/components/auth/submit-button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { AlertCircle, MailCheck } from "lucide-react"

const initial: ActionState = { ok: false }

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, initial)

  if (state.ok && state.step === "verify" && state.email) {
    return <ResetStep email={state.email} />
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormError message={state.error} /> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email address</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
      </div>
      <SubmitButton className="mt-1 w-full" pendingText="Sending code...">
        Send reset code
      </SubmitButton>
    </form>
  )
}

function ResetStep({ email }: { email: string }) {
  const [state, action] = useActionState(resetPasswordAction, initial)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-3">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-success" />
        <p className="text-sm text-foreground">
          We sent a reset code to <span className="font-semibold">{email}</span>. Enter it with your new password.
        </p>
      </div>
      <form action={action} className="flex flex-col gap-4" noValidate>
        {state.error ? <FormError message={state.error} /> : null}
        <input type="hidden" name="email" value={email} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">Reset code</Label>
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required placeholder="123456" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
          <p className="text-xs text-muted-foreground">
            At least 8 characters, with uppercase, lowercase and a number.
          </p>
        </div>
        <SubmitButton className="w-full" pendingText="Updating...">
          Update password
        </SubmitButton>
      </form>
    </div>
  )
}

function FormError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
