import type { Metadata } from "next"
import { MarketingHeader } from "@/components/marketing/marketing-header"
import { MarketingFooter } from "@/components/marketing/marketing-footer"

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms of service for using ApexMaths.",
}

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <article className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Terms of service</h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

          <div className="mt-10 space-y-8 text-pretty leading-relaxed text-muted-foreground">
            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">1. About these terms</h2>
              <p>
                These terms govern your use of ApexMaths. By creating an account you agree to them. They are provided
                for transparency and do not constitute legal advice. ApexMaths is a maths practice tool and is not
                affiliated with, or endorsed by, any school, exam board, or admissions authority.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">2. Accounts</h2>
              <p>
                Accounts must be created and managed by a parent or guardian aged 18 or over, on behalf of their
                children. You are responsible for keeping your sign-in details secure and for activity under your
                account. You may add up to three child profiles per account.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">3. Subscription, trial &amp; billing</h2>
              <p>
                ApexMaths is offered on a monthly subscription of £19.99, following a 7-day free trial. Payments are
                processed by Stripe. Your subscription renews automatically each month until cancelled. You can cancel
                at any time from the billing portal; access continues until the end of the current billing period. We do
                not provide pro-rata refunds for partial periods unless required by law.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">4. Acceptable use</h2>
              <p>
                You agree to use ApexMaths only for its intended educational purpose. You may not attempt to disrupt the
                service, access other users&apos; data, reverse-engineer the question bank, or resell access.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">5. Educational content</h2>
              <p>
                Practice questions and AI-generated explanations are provided to support learning. While we aim for
                accuracy, ApexMaths is a practice aid and we make no guarantee of any particular exam outcome.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">6. Cancellation &amp; deletion</h2>
              <p>
                You can cancel your subscription or delete your account at any time from your account page. Deleting your
                account removes your data as described in our{" "}
                <a href="/privacy" className="text-primary underline-offset-2 hover:underline">
                  Privacy &amp; GDPR
                </a>{" "}
                policy.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">7. Changes to these terms</h2>
              <p>
                We may update these terms from time to time. If we make material changes, we will take reasonable steps
                to let you know. Continued use after changes take effect constitutes acceptance.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">8. Contact</h2>
              <p>For any question about these terms, contact us through the email associated with your account.</p>
            </section>
          </div>
        </article>
      </main>
      <MarketingFooter />
    </div>
  )
}

const LAST_UPDATED = "December 2025"
