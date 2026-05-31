import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { AuthShell } from "@/components/auth/auth-shell"
import { OnboardingForm } from "@/components/auth/onboarding-form"
import { requireParent } from "@/lib/auth/guard"

export const metadata: Metadata = {
  title: "Confirm a few details",
  description: "Confirm your guardian status to finish setting up Apex Maths.",
}

export default async function OnboardingPage() {
  const parent = await requireParent()
  if (parent.guardianAttested && parent.ageAttested) redirect("/dashboard")

  return (
    <AuthShell
      title="Just one quick step"
      subtitle="Apex Maths is managed by adults on behalf of children. Please confirm the following before you continue."
    >
      <OnboardingForm />
    </AuthShell>
  )
}
