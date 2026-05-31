import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requireEntitledParent } from "@/lib/auth/guard"
import { listChildren } from "@/lib/db/children"
import { TOPICS, type Topic } from "@/lib/domain"
import { PracticeLauncher } from "@/components/app/practice-launcher"
import { Button } from "@/components/ui/button"
import { ChevronLeft } from "lucide-react"

export const metadata: Metadata = {
  title: "Start a session",
  description: "Choose a child and a practice session to begin.",
}

export default async function NewPracticePage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; topic?: string }>
}) {
  const { parent } = await requireEntitledParent()
  const children = await listChildren(parent.id)
  if (children.length === 0) redirect("/dashboard")

  const sp = await searchParams
  const initialTopic = sp.topic && TOPICS.includes(sp.topic as Topic) ? (sp.topic as Topic) : undefined

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground">
        <Link href="/dashboard">
          <ChevronLeft className="size-4" />
          Back to dashboard
        </Link>
      </Button>
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Start a session</h1>
      <p className="mt-1 mb-8 text-sm text-muted-foreground">
        Pick who&apos;s practising and the type of session. Everything is timed and marked automatically.
      </p>
      <PracticeLauncher children={children} initialChildId={sp.child} initialTopic={initialTopic} />
    </main>
  )
}
