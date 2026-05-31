import Link from "next/link"
import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Reset the password for your Apex Maths parent account.",
}

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we'll send you a code to set a new password."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/sign-in" className="font-medium text-primary underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
