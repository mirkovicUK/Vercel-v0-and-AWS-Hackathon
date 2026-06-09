import { MarketingHeader } from "@/components/marketing/marketing-header"
import { MarketingFooter } from "@/components/marketing/marketing-footer"
import { ScrollToTopOnLoad } from "@/components/marketing/scroll-to-top-on-load"
import { getCurrentParent } from "@/lib/auth/session"
import {
  Hero,
  ValueProp,
  HowItWorks,
  ProgressShowcase,
  Features,
  Pricing,
  FinalCta,
} from "@/components/marketing/landing-sections"

// Header/CTAs reflect the signed-in state, which is read from cookies per request.
export const dynamic = "force-dynamic"

export default async function HomePage() {
  const parent = await getCurrentParent()
  const authed = parent != null
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTopOnLoad />
      <MarketingHeader />
      <main className="flex-1">
        <Hero authed={authed} />
        <ValueProp />
        <HowItWorks />
        <ProgressShowcase authed={authed} />
        <Features />
        <Pricing authed={authed} />
        <FinalCta authed={authed} />
      </main>
      <MarketingFooter />
    </div>
  )
}
