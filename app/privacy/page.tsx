import type { Metadata } from "next"
import { MarketingHeader } from "@/components/marketing/marketing-header"
import { MarketingFooter } from "@/components/marketing/marketing-footer"

export const metadata: Metadata = {
  title: "Privacy & GDPR",
  description: "How ApexMaths collects, uses, and protects your data, and your rights under UK GDPR.",
}

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <article className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Privacy &amp; GDPR
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

          <div className="mt-10 space-y-8 text-pretty leading-relaxed text-muted-foreground">
            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Who we are</h2>
              <p>
                ApexMaths provides timed 11+ maths practice for UK families. Accounts are created and managed by a
                parent or guardian on behalf of their children. This policy explains what data we hold, why, and the
                rights you have under UK GDPR. It is provided for transparency and is not legal advice.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Data we collect</h2>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong className="text-foreground">Parent account:</strong> your email address and the
                  parent/guardian and age attestations you confirm at sign-up. Identity and passwords are managed by
                  Amazon Cognito; we never store your password.
                </li>
                <li>
                  <strong className="text-foreground">Child profiles:</strong> a display name (which can be a nickname)
                  and an optional year group. We do not require a child&apos;s real name, contact details, or any other
                  personal information.
                </li>
                <li>
                  <strong className="text-foreground">Practice activity:</strong> the questions attempted, answers
                  chosen, scores, and per-topic progress, so we can show meaningful progress reports.
                </li>
                <li>
                  <strong className="text-foreground">Billing:</strong> subscription status and a customer reference
                  from our payments provider, Stripe. Card details are handled entirely by Stripe — we never see or
                  store them.
                </li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">How we use your data</h2>
              <p>
                We use your data to run the service: to authenticate you, deliver practice sessions, track progress,
                generate AI-assisted explanations and parent reports, and manage your subscription. Where an AI feature
                is used, we send only the maths content and aggregate statistics required for the task — never a
                child&apos;s name or other identifying details.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Where your data is stored</h2>
              <p>
                Data is stored in Amazon Web Services in the UK (London, eu-west-2) region. Access is restricted to the
                application using least-privilege credentials, and the database is not publicly reachable.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Your rights</h2>
              <p>Under UK GDPR you can:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>access a copy of your data — use the Export feature on your account page;</li>
                <li>delete your account and all associated data — use the Delete account feature on your account page;</li>
                <li>correct inaccurate data, or object to certain processing.</li>
              </ul>
              <p>
                Deleting your account removes your profile, your children&apos;s profiles, and all practice history.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Children&apos;s privacy</h2>
              <p>
                ApexMaths is operated by adults on behalf of children. A parent or guardian creates and controls the
                account and all child profiles. We deliberately minimise the data held about children to a display name
                and optional year group.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Contact</h2>
              <p>
                For any privacy request or question, contact us through the email associated with your account. We aim
                to respond to data requests within statutory timeframes.
              </p>
            </section>
          </div>
        </article>
      </main>
      <MarketingFooter />
    </div>
  )
}

const LAST_UPDATED = "December 2025"
