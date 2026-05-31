import type { ReactNode } from "react"
import { requireParent } from "@/lib/auth/guard"
import { AppHeader } from "@/components/app/app-header"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const parent = await requireParent()
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader email={parent.email} />
      <div className="flex-1">{children}</div>
    </div>
  )
}
