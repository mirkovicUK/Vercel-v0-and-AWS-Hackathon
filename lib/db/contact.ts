import "server-only"
import { z } from "zod"
import { headers } from "next/headers"
import { query, queryOne } from "@/lib/aws/rds-data"
import { getCurrentParent } from "@/lib/auth/session"
import type { SubscriptionStatus } from "@/lib/domain"

/**
 * Data layer for the Parent Contact Inbox.
 *
 * This server-only module owns the public contact channel's validation schema,
 * its typed shapes, and the **pure, I/O-free helpers** the correctness
 * properties exercise (input validation, the honeypot check, the rate-limit
 * decision, sender-context triage, the inbox payload projection, and the
 * ordering/bound). It also owns the three DB functions (the parameterized
 * INSERT, the rate-limit count, and the `SELECT`-only inbox read), the
 * verified-session `parent_id` derivation, and `readSourceIp()` — all issued
 * through the shared RDS Data API helpers with named `:param` binds, never
 * string-built SQL.
 *
 * No function in this module performs authorization — the inbox read is gated
 * once at the `/admin` boundary by the reused `requireAdmin()` guard, exactly as
 * the Metrics_Service is.
 *
 * The payload types below form a **PII firewall by construction**: neither
 * `ContactInboxItem` nor `SenderContext` carries a slot for a forbidden field (a
 * Cognito `sub`, a `stripe_customer_id`, the rate-limit `source_ip`, or any child
 * attribute), so a forbidden value has nowhere to live (Req 10.2–10.4).
 */

// ---- Tunable anti-abuse / cost-bounding constants (visible, testable) ----

/** Rolling rate-limit window, minutes (Req 4.2, 4.3). */
export const RATE_LIMIT_WINDOW_MINUTES = 60
/** Max submissions per email AND per source IP within the window (Req 4.2, 4.3). */
export const RATE_LIMIT_MAX = 5
/** Inbox_Row_Limit — bounds the inbox query cost (Req 8.1). */
export const INBOX_ROW_LIMIT = 50

// ---- Validation schema and pure validator (Req 2) ----

/**
 * Bounded-length submission schema, mirroring the app's Zod conventions
 * (`.trim()`, `.min/.max` with friendly messages, `.email()`) used in
 * `app/(auth)/actions.ts` and `app/(app)/children/actions.ts`: name trimmed to
 * 1–80, email trimmed + lowercased + syntactically valid within 3–254, message
 * trimmed to 10–2000 (Req 2.2, 2.3, 2.4).
 */
export const Contact_Schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Please enter your name.")
    .max(80, "That name is a bit long — keep it under 80 characters."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Enter a valid email address.")
    .max(254, "That email address is too long.")
    .email("Enter a valid email address."),
  message: z
    .string()
    .trim()
    .min(10, "Please add a little more detail (at least 10 characters).")
    .max(2000, "That message is too long — keep it under 2000 characters."),
})

export type ContactInput = z.infer<typeof Contact_Schema>

/** Result of validating a raw submission: the parsed data on success, a friendly message on failure. */
export interface ContactValidationResult {
  ok: boolean
  data?: ContactInput
  error?: string
}

/** Pure: validate raw fields against the bounds; first issue message on failure (Req 2.1–2.4). */
export function validateContactInput(raw: {
  name: unknown
  email: unknown
  message: unknown
}): ContactValidationResult {
  const parsed = Contact_Schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the details." }
  }
  return { ok: true, data: parsed.data }
}

/** Pure: a genuine submission leaves the honeypot empty; any non-empty string value is a bot (Req 5.2). */
export function isHoneypotTriggered(honeypot: unknown): boolean {
  return typeof honeypot === "string" && honeypot.trim().length > 0
}

// ---- Rate-limit pure decision (Req 4) ----

/** Pure: reject once either count has REACHED the allowance (>=), boundary inclusive (Req 4.2, 4.3). */
export function isRateLimited(
  counts: { byEmail: number; byIp: number },
  max: number = RATE_LIMIT_MAX,
): boolean {
  return counts.byEmail >= max || counts.byIp >= max
}

// ---- Inbox types (the type-level PII firewall) ----

/**
 * One raw row of the joined inbox `SELECT` (`contact_messages` ⋈ `parents` ⋈
 * `subscriptions`). It names only the permitted columns — never `parents.id`/
 * `sub`, `stripe_customer_id`, `source_ip`, or any child column.
 */
export interface ContactInboxRow {
  id: string
  submitter_name: string
  submitter_email: string
  message: string
  created_at: string
  parent_id: string | null
  linked_parent_email: string | null
  subscription_status: string | null
}

/**
 * Sender context for triage, total over the three cases of Req 8.4–8.6: a
 * logged-out Visitor (no linked identity), or a linked Parent carrying their
 * email and a Subscription_Status (`"none"` when the Parent has no subscription).
 */
export type SenderContext =
  | { kind: "logged_out" } // parent_id null (Req 8.5)
  | { kind: "linked"; parentEmail: string; subscriptionStatus: SubscriptionStatus | "none" } // (Req 8.4, 8.6)

/**
 * The inbox payload the admin card renders. The permitted set is *exactly*
 * `{ id, submitterName, submitterEmail, message, createdAt, sender }`: there is
 * no field for any forbidden attribute (Req 8.3–8.6, 10.2–10.4).
 */
export interface ContactInboxItem {
  id: string
  submitterName: string
  submitterEmail: string
  message: string
  createdAt: string
  sender: SenderContext
}

// ---- Pure mapping/ordering helpers (no I/O — unit/property testable) ----

/**
 * Pure: map a joined row's nullable parent/subscription columns to a total
 * `SenderContext`. A null `parent_id` OR a null linked email yields `logged_out`
 * (never invent an identity — Req 8.5); otherwise a `linked` context carrying the
 * email and the subscription status, defaulting a missing subscription to
 * `"none"` rather than an invented status (Req 8.4, 8.6).
 */
export function mapSenderContext(row: {
  parent_id: string | null
  linked_parent_email: string | null
  subscription_status: string | null
}): SenderContext {
  if (row.parent_id === null || row.linked_parent_email === null) {
    return { kind: "logged_out" }
  }
  return {
    kind: "linked",
    parentEmail: row.linked_parent_email,
    subscriptionStatus: (row.subscription_status as SubscriptionStatus | null) ?? "none",
  }
}

/** Pure: project a joined row to the PII-bounded inbox payload (Req 8.3–8.6, 10.2–10.4). */
export function mapContactInboxRow(row: ContactInboxRow): ContactInboxItem {
  return {
    id: row.id,
    submitterName: row.submitter_name,
    submitterEmail: row.submitter_email,
    message: row.message,
    createdAt: row.created_at,
    sender: mapSenderContext(row),
  }
}

/**
 * Pure: order `rows` by `created_at` descending and keep at most `limit` rows.
 * This mirrors the inbox SQL's `ORDER BY cm.created_at DESC LIMIT :limit` so the
 * ordering/bound is property-testable in-memory: the result is sorted
 * newest-first and retains exactly the most-recent `limit` rows (Req 8.1).
 */
export function orderAndLimitByCreatedAtDesc<T extends { created_at: string }>(
  rows: T[],
  limit: number,
): T[] {
  return [...rows]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, Math.max(0, limit))
}

// ---- DB functions (RDS Data API, named :param binds — never string-built SQL) ----
//
// Parameter-binding convention (see `lib/aws/rds-data.ts` `toField`): named
// `:param` placeholders are bound from a plain object. A `number` that is an
// integer binds as `longValue` (Postgres `bigint`), so where an `integer` is
// required — e.g. the `mins` argument to `make_interval` — the bound value needs
// an explicit `::int` cast. A `null` binds as SQL NULL, and a `string` binds as
// text, so the rate-limit count and the INSERT pass every value as a bound
// parameter and never interpolate it.

/**
 * Prior submissions in the rolling window for this email and (when present) this
 * IP, as a single parameterized `SELECT` over recent rows — no new
 * infrastructure (Req 4.2, 4.3, 4.5). The per-IP filter is guarded by
 * `:ip IS NOT NULL` so a missing IP contributes a `by_ip` count of `0` and only
 * the per-email limit applies. `:windowMinutes` is cast to `::int` because an
 * integer binds as `bigint` and `make_interval(mins => …)` expects an `integer`.
 */
export async function countRecentSubmissions(
  email: string,
  ip: string | null,
  windowMinutes: number = RATE_LIMIT_WINDOW_MINUTES,
): Promise<{ byEmail: number; byIp: number }> {
  const row = await queryOne<{ by_email: number; by_ip: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE email = :email)::int                      AS by_email,
       COUNT(*) FILTER (WHERE :ip IS NOT NULL AND source_ip = :ip)::int AS by_ip
     FROM contact_messages
     WHERE created_at >= now() - make_interval(mins => :windowMinutes::int)`,
    { email, ip, windowMinutes },
  )
  return { byEmail: Number(row?.by_email ?? 0), byIp: Number(row?.by_ip ?? 0) }
}

/**
 * Verified-session-only parent id. Derived solely from `getCurrentParent()` (the
 * cryptographically verified Cognito session): a signed-in Parent's `id`, or
 * `null` when logged out. Never reads any client-supplied identifier from the
 * form, headers, query, or cookies beyond the verified session tokens (Req 3.2–3.4).
 */
export async function deriveParentId(): Promise<string | null> {
  return (await getCurrentParent())?.id ?? null
}

/**
 * Persist exactly one Contact_Message via a parameterized statement (Req 2.5,
 * 2.6, 3.6). `status` is hard-coded to `'new'` in the SQL text and `created_at`
 * defaults to `now()` at the DB — neither is client-supplied. Every value is
 * bound, never interpolated.
 */
export async function insertContactMessage(input: {
  name: string
  email: string
  message: string
  parentId: string | null
  sourceIp: string | null
}): Promise<void> {
  await query(
    `INSERT INTO contact_messages (parent_id, name, email, message, source_ip, status)
     VALUES (:parentId, :name, :email, :message, :sourceIp, 'new')`,
    {
      parentId: input.parentId,
      name: input.name,
      email: input.email,
      message: input.message,
      sourceIp: input.sourceIp,
    },
  )
}

/**
 * The inbox read — a single `LEFT JOIN contact_messages → parents →
 * subscriptions`, newest-first, bounded by `:limit`. The `SELECT` list is the
 * PII firewall: it names **only** the permitted columns and never selects
 * `source_ip`, `parents.id`/`sub`, `stripe_customer_id`, or any child column
 * (none is even joined). Because `subscriptions` has a `UNIQUE (parent_id)`
 * constraint, the join yields at most one subscription row per message — no
 * fan-out (Req 8.1–8.6, 10.2–10.4, 11.1).
 */
export const CONTACT_INBOX_SQL = `
  SELECT cm.id,
         cm.name        AS submitter_name,
         cm.email       AS submitter_email,
         cm.message,
         cm.created_at,
         cm.parent_id,
         p.email        AS linked_parent_email,
         s.status       AS subscription_status
  FROM contact_messages cm
  LEFT JOIN parents p       ON p.id = cm.parent_id
  LEFT JOIN subscriptions s ON s.parent_id = cm.parent_id
  ORDER BY cm.created_at DESC
  LIMIT :limit`

/**
 * The most-recent Contact_Messages with sender context, bounded by
 * `INBOX_ROW_LIMIT`. One `SELECT` via the RDS Data API, each row mapped to the
 * PII-firewalled payload (Req 8.1, 8.2). No authorization here — the gate runs
 * once at the `/admin` boundary, exactly as the Metrics_Service does.
 */
export async function getContactInbox(): Promise<ContactInboxItem[]> {
  const rows = await query<ContactInboxRow>(CONTACT_INBOX_SQL, { limit: INBOX_ROW_LIMIT })
  return rows.map(mapContactInboxRow)
}

/**
 * First hop of `x-forwarded-for` is the original client IP on Vercel (which
 * terminates TLS at the edge and forwards the client IP in that standard
 * header); `null` when absent. Reading the IP is best-effort — when the header
 * is missing the per-IP rate-limit count is `0` and only the per-email limit
 * applies. Uses the same `headers()` primitive `app/(app)/billing/actions.ts`
 * already relies on (Req 4.5).
 */
export async function readSourceIp(): Promise<string | null> {
  const h = await headers()
  const xff = h.get("x-forwarded-for")
  if (!xff) return null
  const first = xff.split(",")[0]?.trim()
  return first && first.length > 0 ? first : null
}
