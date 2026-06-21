/**
 * Shared, presentation-only formatting helpers for the admin metric cards.
 *
 * Date formatting mirrors the locale/`Intl` pattern used elsewhere in the app
 * (see `app/(app)/billing/page.tsx`, `components/app/session-history.tsx`): a
 * short `en-GB` date, with a missing value rendered as an em dash.
 */

/** Format an ISO timestamp as a short `en-GB` date, or "—" when absent/invalid. */
export function formatAdminDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/** Format an ISO timestamp as a short `en-GB` date and time, or "—" when absent/invalid. */
export function formatAdminDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
