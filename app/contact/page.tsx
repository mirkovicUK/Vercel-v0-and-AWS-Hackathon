import type { Metadata } from "next"
import { getCurrentParent } from "@/lib/auth/session"
import { MarketingHeader } from "@/components/marketing/marketing-header"
import { MarketingFooter } from "@/components/marketing/marketing-footer"
import { ContactForm } from "@/components/marketing/contact-form"

export const metadata: Metadata = {
  title: "Contact us",
  description: "Get in touch with the ApexMaths team.",
}

export default async function ContactPage() {
  // null when logged out — used only to prefill the email field (Req 1.4, 10.1)
  const parent = await getCurrentParent()
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-xl px-4 py-16 sm:px-6">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Contact us</h1>
          <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
            Have a question or some feedback? Send us a message and we&apos;ll get back to you.
          </p>
          <ContactForm defaultEmail={parent?.email ?? ""} />
        </div>
      </main>
      <MarketingFooter />
    </div>
  )
}
