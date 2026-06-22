"use client"

import { useActionState } from "react"
import { submitContactAction, type ContactActionState } from "@/app/contact/actions"
import { SubmitButton } from "@/components/auth/submit-button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { AlertCircle, MailCheck } from "lucide-react"

const initial: ContactActionState = { ok: false }

export function ContactForm({ defaultEmail }: { defaultEmail?: string }) {
  const [state, action] = useActionState(submitContactAction, initial)

  if (state.ok) {
    return (
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-success" />
        <p className="text-sm text-foreground">
          Thanks — your message has been sent. We&apos;ll be in touch.
        </p>
      </div>
    )
  }

  return (
    <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
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
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" type="text" autoComplete="name" required maxLength={80} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={defaultEmail}
          placeholder="you@example.com"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="message">Message</Label>
        <Textarea id="message" name="message" required minLength={10} maxLength={2000} rows={6} />
      </div>

      {/* Honeypot: off-screen and hidden from genuine, keyboard, and screen-reader
          users. A non-empty value flags an automated submission (Req 5.1). */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <SubmitButton className="mt-1 w-full" pendingText="Sending...">
        Send message
      </SubmitButton>
    </form>
  )
}
