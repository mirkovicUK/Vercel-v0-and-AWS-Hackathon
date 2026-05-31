"use client"

import { useState, useTransition } from "react"
import { gatherMyData } from "@/app/(app)/account/actions"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Download } from "lucide-react"

export function ExportDataButton() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleExport() {
    setError(null)
    startTransition(async () => {
      try {
        const data = await gatherMyData()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `apex-data-export-${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      } catch {
        setError("Could not generate your export. Please try again.")
      }
    })
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" onClick={handleExport} disabled={pending} className="gap-2">
        {pending ? <Spinner className="size-4" /> : <Download className="size-4" />}
        Download my data
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
