import Link from "next/link"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { AuthShell } from "@/components/auth/auth-shell"
import { SignInForm } from "@/components/auth/sign-in-form"
import { getCurrentParent } from "@/lib/auth/session"
import { CheckCircle2 } from "lucide-react"

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your ApexMaths parent account.",
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; reset?: string }>
}) {
  const parent = await getCurrentParent()
  if (parent) redirect("/dashboard")

  const { verified, reset } = await searchParams

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to view your children's progress and start a practice session."
      footer={
        <>
          New to ApexMaths?{" "}
          <Link href="/sign-up" className="font-medium text-primary underline-offset-2 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {verified || reset ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-foreground">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          <span>{verified ? "Your email is verified. Please sign in." : "Your password has been updated. Please sign in."}</span>
        </div>
      ) : null}
      <SignInForm />
    </AuthShell>
  )
}
