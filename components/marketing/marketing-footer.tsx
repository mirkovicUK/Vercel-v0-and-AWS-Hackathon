import Link from "next/link"
import { Logo } from "@/components/logo"

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Affordable, AI-supported 11+ maths practice for UK families. Built to give every child a fair chance.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            <FooterColumn
              title="Product"
              links={[
                { href: "#how-it-works", label: "How it works" },
                { href: "#features", label: "Features" },
                { href: "#pricing", label: "Pricing" },
                { href: "/contact", label: "Contact us" },
              ]}
            />
            <FooterColumn
              title="Account"
              links={[
                { href: "/sign-in", label: "Sign in" },
                { href: "/sign-up", label: "Start free trial" },
              ]}
            />
            <FooterColumn
              title="Legal"
              links={[
                { href: "/privacy", label: "Privacy notice" },
                { href: "/terms", label: "Terms" },
              ]}
            />
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} ApexMaths. All rights reserved.</p>
          <p>Made for UK families · Prices in GBP</p>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({
  title,
  links,
}: {
  title: string
  links: { href: string; label: string }[]
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
