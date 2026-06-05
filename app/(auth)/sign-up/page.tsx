import Link from "next/link"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { AuthShell } from "@/components/auth/auth-shell"
import { SignUpForm } from "@/components/auth/sign-up-form"
import { getCurrentParent } from "@/lib/auth/session"

export const metadata: Metadata = {
  title: "Create your account",
  description: "Start your free trial of ApexMaths and help your child master the 11+ maths curriculum.",
}

export default async function SignUpPage() {
  const parent = await getCurrentParent()
  if (parent) redirect("/dashboard")

  return (
    <AuthShell
      title="Create your parent account"
      subtitle="One account manages all of your children. Start with a free trial — no card required to explore."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-primary underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthShell>
  )
}
