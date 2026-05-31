import { MarketingHeader } from "@/components/marketing/marketing-header"
import { MarketingFooter } from "@/components/marketing/marketing-footer"
import {
  Hero,
  ValueProp,
  HowItWorks,
  ProgressShowcase,
  Features,
  Pricing,
  FinalCta,
} from "@/components/marketing/landing-sections"

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <Hero />
        <ValueProp />
        <HowItWorks />
        <ProgressShowcase />
        <Features />
        <Pricing />
        <FinalCta />
      </main>
      <MarketingFooter />
    </div>
  )
}
