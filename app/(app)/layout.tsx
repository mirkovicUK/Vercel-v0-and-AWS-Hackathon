import type { ReactNode } from "react"
import { requireParent } from "@/lib/auth/guard"
import { getCurrentClaims, isAdminClaims } from "@/lib/auth/session"
import { AppHeader } from "@/components/app/app-header"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const parent = await requireParent()
  const isAdmin = isAdminClaims(await getCurrentClaims())
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader email={parent.email} isAdmin={isAdmin} />
      <div className="flex-1">{children}</div>
    </div>
  )
}
