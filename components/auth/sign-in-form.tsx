"use client"

import { useActionState } from "react"
import Link from "next/link"
import { signInAction, type ActionState } from "@/app/(auth)/actions"
import { SubmitButton } from "@/components/auth/submit-button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { AlertCircle } from "lucide-react"

const initial: ActionState = { ok: false }

export function SignInForm() {
  const [state, action] = useActionState(signInAction, initial)

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
