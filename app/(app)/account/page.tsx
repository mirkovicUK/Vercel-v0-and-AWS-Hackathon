import Link from "next/link"
import { requireParent } from "@/lib/auth/guard"
import { getEntitlement } from "@/lib/db/subscriptions"
import { ExportDataButton } from "@/components/app/export-data-button"
import { DeleteAccountDialog } from "@/components/app/delete-account-dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, CreditCard, ShieldCheck } from "lucide-react"

export const metadata = { title: "Account & privacy — ApexMaths" }

export default async function AccountPage() {
  const parent = await requireParent()
  const entitlement = await getEntitlement(parent.id)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to dashboard
      </Link>

      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Account &amp; privacy</h1>
      <p className="mt-1 text-pretty text-muted-foreground">Manage your sign-in, billing and personal data.</p>

      <div className="mt-8 grid gap-6">
        {/* Account details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
            <CardDescription>You&apos;re signed in as the account holder.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium text-foreground">{parent.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Guardian consent</span>
              <span className="font-medium text-foreground">{parent.guardianAttested ? "Confirmed" : "Pending"}</span>
            </div>
          </CardContent>
        </Card>

        {/* Billing shortcut */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="size-4 text-primary" />
              Billing
            </CardTitle>
            <CardDescription>
              {entitlement.status === "trialing"
                ? "You're on a free trial."
                : entitlement.entitled
                  ? "Your plan is active."
                  : "No active plan."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/billing">Go to billing</Link>
            </Button>
          </CardContent>
        </Card>

        {/* GDPR: data export */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-primary" />
              Your data
            </CardTitle>
            <CardDescription className="text-pretty">
              Download a copy of all personal data we hold for your account and children, in machine-readable JSON.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExportDataButton />
          </CardContent>
        </Card>

        {/* GDPR: deletion */}
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
            <CardDescription className="text-pretty">
              Permanently delete your account and all associated data. Any active subscription is cancelled
              automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteAccountDialog />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
