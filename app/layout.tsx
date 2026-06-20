import type { Metadata, Viewport } from "next"
import { Inter, Plus_Jakarta_Sans } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-jakarta",
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "ApexMaths — Affordable AI tutoring for the 11+ exam",
    template: "%s · ApexMaths",
  },
  description:
    "Help your child prepare for the UK 11+ maths exam with adaptive practice that targets their weak topics, an AI tutor, and a per-child progress dashboard with AI review reports. £19.99/month with a 7-day free trial.",
  generator: "v0.app",
  keywords: ["11 plus", "11+ maths", "UK exam prep", "AI tutoring", "adaptive learning", "grammar school", "maths practice"],
}

export const viewport: Viewport = {
  themeColor: "#0ea5e9",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en-GB" className={`${inter.variable} ${jakarta.variable} bg-background`}>
      <body className="font-sans antialiased">
        {children}
        <Toaster />
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
