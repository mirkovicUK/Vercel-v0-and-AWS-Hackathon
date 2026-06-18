"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

/**
 * TEMPORARY diagnostic error boundary for the child page.
 *
 * Next.js otherwise replaces a client-side render crash with a generic
 * "This page couldn't load" screen that hides the real message. This boundary
 * surfaces the actual error (message + stack + digest) so we can see what is
 * throwing when the AI review report dialog streams in. Remove once diagnosed.
 */
export default function ChildPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Also dump it to the browser console for the full stack.
    console.error("[child-page-error]", error)
  }, [error])

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="text-lg font-semibold text-destructive">Something threw on this page</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Diagnostic boundary — showing the real error below.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Message</p>
          <pre className="mt-1 overflow-auto rounded-md border bg-muted/40 p-3 text-xs text-foreground">
            {error?.name}: {error?.message || "(no message)"}
          </pre>
        </div>
        {error?.digest ? (
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Digest</p>
            <pre className="mt-1 rounded-md border bg-muted/40 p-3 text-xs">{error.digest}</pre>
          </div>
        ) : null}
        {error?.stack ? (
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Stack</p>
            <pre className="mt-1 max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed">
              {error.stack}
            </pre>
          </div>
        ) : null}
      </div>

      <Button onClick={reset} variant="outline" className="mt-4">
        Try again
      </Button>
    </div>
  )
}
