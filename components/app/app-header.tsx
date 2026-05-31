import Link from "next/link"
import { Logo } from "@/components/logo"
import { signOutAction } from "@/app/(auth)/actions"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChildAvatar } from "@/components/app/child-avatar"
import { LogOut, CreditCard, LayoutDashboard } from "lucide-react"

export function AppHeader({ email }: { email: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/dashboard" aria-label="Apex Maths dashboard">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1" aria-label="Account">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/dashboard">
              <LayoutDashboard className="size-4" />
              Dashboard
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2 rounded-full p-1 pr-2 text-sm transition-colors hover:bg-secondary"
                aria-label="Account menu"
              >
                <ChildAvatar name={email} color="blue" className="size-8 text-xs" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/billing">
                  <CreditCard className="size-4" />
                  Billing & plan
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild variant="destructive">
                <form action={signOutAction} className="w-full">
                  <button type="submit" className="flex w-full items-center gap-2">
                    <LogOut className="size-4" />
                    Sign out
                  </button>
                </form>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </div>
    </header>
  )
}
