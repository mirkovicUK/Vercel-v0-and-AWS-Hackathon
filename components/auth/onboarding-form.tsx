"use client"

import { useActionState } from "react"
import { completeOnboardingAction, type ActionState } from "@/app/(auth)/actions"
import { SubmitButton } from "@/components/auth/submit-button"
import { Checkbox } from "@/components/ui/checkbox"
import { AlertCircle } from "lucide-react"

const initial: ActionState = { ok: false }

export function OnboardingForm() {
  const [state, action] = useActionState(completeOnboardingAction, initial)
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-secondary/50">
        <Checkbox name="guardian" className="mt-0.5" />
        <span className="text-sm leading-relaxed text-foreground">
          I am the parent or legal guardian of the child or children who will use this account, and I consent to them
          practising on this platform.
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-secondary/50">
        <Checkbox name="age" className="mt-0.5" />
        <span className="text-sm leading-relaxed text-foreground">
          I am 18 years or older and I will manage all account settings, billing and personal data on behalf of my
          child.
        </span>
      </label>

      <SubmitButton className="w-full" pendingText="Saving...">
        Continue to dashboard
      </SubmitButton>
    </form>
  )
}
