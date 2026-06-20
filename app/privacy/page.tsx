import type { Metadata } from "next"
import { MarketingHeader } from "@/components/marketing/marketing-header"
import { MarketingFooter } from "@/components/marketing/marketing-footer"

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "How ApexMaths collects, uses, and protects your data, and your rights under UK GDPR.",
}

const LAST_UPDATED = "June 2026"

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <article className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Privacy notice</h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            This notice explains what data we collect when you use ApexMaths, why we collect it, how long we keep it,
            and the rights you have under UK GDPR. It is provided for transparency and is not legal advice.
          </p>

          <div className="mt-10 space-y-8 text-pretty leading-relaxed text-muted-foreground">
            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Who we are</h2>
              <p>
                &ldquo;We&rdquo; means ApexMaths, the operator of this service. We are the data controller for the
                personal data described in this notice. ApexMaths provides timed 11+ maths practice for UK families;
                accounts are created and managed by a parent or guardian on behalf of their children.
              </p>
              <p>
                For data-protection enquiries, contact us through the email associated with your account. You can also
                raise complaints with the UK Information Commissioner&apos;s Office at{" "}
                <a href="https://ico.org.uk" className="text-primary underline-offset-4 hover:underline">
                  ico.org.uk
                </a>
                .
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">What data we collect</h2>
              <p className="font-medium text-foreground">For each parent account:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Email address.</li>
                <li>Password — stored and verified by Amazon Cognito; we never see or store it ourselves.</li>
                <li>Email verification status.</li>
                <li>The date you accepted the parent / guardian and age attestations.</li>
                <li>A Stripe customer reference linking your account to your subscription.</li>
              </ul>
              <p className="font-medium text-foreground">For each child profile you create:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>A display name you choose (which can be a nickname).</li>
                <li>An optional year group (Year 4, 5 or 6).</li>
                <li>The dates and results of practice sessions.</li>
                <li>Topic-level progress (questions attempted, answers correct, mastery score).</li>
              </ul>
              <p>
                We do not collect any other personal data about children — no email, no date of birth, no school, no
                contact details, and no photos.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Why we collect it (lawful basis)</h2>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong className="text-foreground">Parent account:</strong> contract performance — we cannot provide
                  the service without it.
                </li>
                <li>
                  <strong className="text-foreground">Child profile and practice data:</strong> consent from the parent
                  or legal guardian (the attestation you accepted at sign-up). You can withdraw consent at any time by
                  deleting a child, or your whole account, from your account settings.
                </li>
                <li>
                  <strong className="text-foreground">Subscription data:</strong> contract performance and legal
                  obligation (financial record-keeping).
                </li>
                <li>
                  <strong className="text-foreground">Audit log of significant actions:</strong> legitimate interest —
                  security, fraud prevention, and (as this service was originally built for a hackathon) competition
                  submission evidence.
                </li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">How long we keep it</h2>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong className="text-foreground">Account data</strong> (parent, children, practice sessions,
                  progress): until you delete your account. Deleting your account removes this data immediately, and in
                  any case within 30 days.
                </li>
                <li>
                  <strong className="text-foreground">Audit log:</strong> retained for security and accountability,
                  typically for at least 12 months.
                </li>
                <li>
                  <strong className="text-foreground">Subscription and invoice records:</strong> held by Stripe under
                  their own retention policy (typically 6–10 years for tax and accounting compliance). When you delete
                  your account, we de-attribute your customer record on our side, but Stripe may retain invoice records
                  as required by law.
                </li>
                <li>
                  <strong className="text-foreground">Aggregated revenue counts:</strong> retained indefinitely as
                  non-personal, aggregate data only.
                </li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Your rights</h2>
              <p>Under UK GDPR you have the right to:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong className="text-foreground">Access</strong> the data we hold about you — download a complete
                  export from <em>My account → Export my data</em>.
                </li>
                <li>
                  <strong className="text-foreground">Erasure</strong> — delete your account from{" "}
                  <em>My account → Danger zone</em>. This permanently deletes your account, your children&apos;s
                  profiles, and all practice data.
                </li>
                <li>
                  <strong className="text-foreground">Rectification</strong> — edit your children&apos;s profiles
                  directly in the dashboard.
                </li>
                <li>
                  <strong className="text-foreground">Object to or restrict processing, and data portability</strong> —
                  the export feature delivers your data in a machine-readable format you can re-use.
                </li>
                <li>
                  <strong className="text-foreground">Lodge a complaint</strong> with the ICO at{" "}
                  <a href="https://ico.org.uk" className="text-primary underline-offset-4 hover:underline">
                    ico.org.uk
                  </a>
                  .
                </li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Third parties we share data with</h2>
              <p>We are a small operation. The only third parties involved are:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong className="text-foreground">Amazon Web Services</strong> (database, authentication, file
                  storage and AI infrastructure). Your data is stored and processed in AWS&apos;s London (eu-west-2)
                  region. AWS acts as a data processor under our agreement.
                </li>
                <li>
                  <strong className="text-foreground">Vercel</strong> (application hosting). Our application runs on
                  Vercel&apos;s serverless platform in the London (lhr1) region, alongside our AWS data.
                </li>
                <li>
                  <strong className="text-foreground">Stripe</strong> (payments). When you start a subscription you
                  enter your card details directly on Stripe&apos;s hosted pages. We never see or store your card
                  details. Stripe is the data controller for payment data.
                </li>
                <li>
                  <strong className="text-foreground">Anthropic Claude, via Amazon Bedrock</strong> (the AI that powers
                  &ldquo;Show me how&rdquo; hints, post-session reviews, and the parent progress report). We send only
                  the question text, options, any figure description, and your child&apos;s year group. We never send
                  your child&apos;s display name, your email, or any other identifying information to the model, and the
                  request is processed within AWS in the EU/UK.
                </li>
              </ul>
              <p>
                We do not share data with advertisers or marketing networks, and we do not sell your data.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Cookies and analytics</h2>
              <p>
                We use only <strong className="text-foreground">strictly necessary cookies</strong>, which are exempt
                from consent under PECR:
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong className="text-foreground">Authentication / session cookies</strong> — set by us as
                  secure, HTTP-only cookies to keep you signed in. They are not readable by client-side scripts.
                </li>
                <li>
                  <strong className="text-foreground">Stripe cookies</strong> — set by Stripe on its own hosted pages
                  when you go through checkout or the Customer Portal. These belong to Stripe; see Stripe&apos;s cookie
                  notice.
                </li>
              </ul>
              <p>
                For product analytics we use <strong className="text-foreground">Vercel Analytics</strong>, which
                collects privacy-friendly, aggregated usage statistics (such as page views and performance) without
                using tracking cookies and without identifying you. We do not use advertising cookies, social-media
                tracking pixels, or any other tracking technology.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Children&apos;s privacy</h2>
              <p>
                ApexMaths is operated by adults on behalf of children. A parent or guardian creates and controls the
                account and all child profiles, and we deliberately minimise the data held about a child to a display
                name and an optional year group.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">International transfers</h2>
              <p>
                Your data is processed in the United Kingdom and the European Economic Area. Where AWS, Vercel, or
                Stripe transfer data outside the UK/EEA, they do so under their own UK/EU adequacy decisions and
                standard contractual clauses.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Changes to this notice</h2>
              <p>
                If we update this notice we will change the date at the top. Material changes (for example, adding a new
                third party or a new category of personal data) will be notified to you by email before they take
                effect.
              </p>
            </section>
          </div>
        </article>
      </main>
      <MarketingFooter />
    </div>
  )
}
