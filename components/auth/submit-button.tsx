"use client"

import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { ComponentProps, ReactNode } from "react"

export function SubmitButton({
  children,
  pendingText,
  ...props
}: { children: ReactNode; pendingText?: string } & ComponentProps<typeof Button>) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} {...props}>
      {pending ? (
        <>
          <Spinner />
          {pendingText ?? "Please wait..."}
        </>
      ) : (
        children
      )}
    </Button>
  )
}
