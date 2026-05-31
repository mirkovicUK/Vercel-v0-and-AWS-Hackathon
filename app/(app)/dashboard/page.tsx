import type { Metadata } from "next"
import { requireOnboardedParent } from "@/lib/auth/guard"
import { listChildren } from "@/lib/db/children"
import { getChildProgress } from "@/lib/db/progress"
import { getEntitlement } from "@/lib/db/subscriptions"
import { MAX_CHILDREN_PER_PARENT } from "@/lib/domain"
import { ChildProgressCard } from "@/components/app/child-progress-card"
import { AddChildDialog } from "@/components/app/add-child-dialog"
import { EntitlementBanner } from "@/components/app/entitlement-banner"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"
import { Users } from "lucide-react"

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Track each child's progress across all six 11+ maths topics.",
}

export default async function DashboardPage() {
  const parent = await requireOnboardedParent()
  const [children, entitlement] = await Promise.all([listChildren(parent.id), getEntitlement(parent.id)])

  // Fetch progress for every child in parallel.
  const progressByChild = await Promise.all(children.map((c) => getChildProgress(c.id)))

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Your children
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Track mastery across all six topics and see exactly what to practise next.
            </p>
          </div>
          {children.length > 0 && children.length < MAX_CHILDREN_PER_PARENT ? (
            <AddChildDialog triggerVariant="outline" />
          ) : null}
        </div>

        <EntitlementBanner entitlement={entitlement} />

        {children.length === 0 ? (
          <Empty className="rounded-2xl border border-dashed border-border bg-card py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users className="size-6" />
              </EmptyMedia>
              <EmptyTitle>Add your first child</EmptyTitle>
              <EmptyDescription>
                Create a profile to start tracking their 11+ maths progress. You can add up to {MAX_CHILDREN_PER_PARENT}{" "}
                children on one account.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <AddChildDialog triggerLabel="Add your first child" />
            </EmptyContent>
          </Empty>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {children.map((child, i) => (
              <ChildProgressCard key={child.id} child={child} progress={progressByChild[i]!} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
