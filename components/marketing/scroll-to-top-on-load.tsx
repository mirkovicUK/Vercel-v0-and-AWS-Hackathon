"use client"

import { useEffect } from "react"

/**
 * The marketing nav uses in-page hash anchors (#pricing, #features, ...). After
 * clicking one, the hash sticks in the URL, so navigating back to the homepage
 * lands part-way down the page. On mount, if there is no hash, force the window
 * to the top so a fresh visit always starts at the hero.
 */
export function ScrollToTopOnLoad() {
  useEffect(() => {
    if (typeof window !== "undefined" && !window.location.hash) {
      window.scrollTo(0, 0)
    }
  }, [])
  return null
}
