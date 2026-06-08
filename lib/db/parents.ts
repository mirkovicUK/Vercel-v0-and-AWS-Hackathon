import "server-only"
import { query, queryOne } from "@/lib/aws/rds-data"
import type { Parent } from "@/lib/domain"

interface ParentRow {
  id: string
  email: string
  guardian_attested: boolean
  age_attested: boolean
  stripe_customer_id: string | null
  created_at: string
  deleted_at: string | null
  // Server-only: deliberately NOT surfaced via mapParent / the client-facing Parent type (Req 1.2).
  has_used_trial: boolean
}

function mapParent(row: ParentRow): Parent {
  return {
    id: row.id,
    email: row.email,
    guardianAttested: row.guardian_attested,
    ageAttested: row.age_attested,
    stripeCustomerId: row.stripe_customer_id,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  }
}

export async function getParentById(id: string): Promise<Parent | null> {
  const row = await queryOne<ParentRow>(
    `SELECT id, email, guardian_attested, age_attested, stripe_customer_id, created_at, deleted_at, has_used_trial
     FROM parents WHERE id = :id AND deleted_at IS NULL`,
    { id },
  )
  return row ? mapParent(row) : null
}

/** Create the parent record if it does not yet exist (first login after Cognito sign-up). */
export async function upsertParent(input: {
  id: string
  email: string
  guardianAttested?: boolean
  ageAttested?: boolean
}): Promise<Parent> {
  const row = await queryOne<ParentRow>(
    `INSERT INTO parents (id, email, guardian_attested, age_attested)
     VALUES (:id, :email, :guardian, :age)
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, email, guardian_attested, age_attested, stripe_customer_id, created_at, deleted_at, has_used_trial`,
    {
      id: input.id,
      email: input.email,
      guardian: input.guardianAttested ?? false,
      age: input.ageAttested ?? false,
    },
  )
  return mapParent(row!)
}

/** Record the guardian / age attestations during onboarding. */
export async function setAttestations(parentId: string): Promise<Parent | null> {
  const row = await queryOne<ParentRow>(
    `UPDATE parents SET guardian_attested = TRUE, age_attested = TRUE
     WHERE id = :id AND deleted_at IS NULL
     RETURNING id, email, guardian_attested, age_attested, stripe_customer_id, created_at, deleted_at, has_used_trial`,
    { id: parentId },
  )
  return row ? mapParent(row) : null
}

/** Soft-delete the parent (GDPR). Cascades to children/sessions via FK on hard purge. */
export async function softDeleteParent(parentId: string): Promise<void> {
  await query(`UPDATE parents SET deleted_at = now() WHERE id = :id`, { id: parentId })
}

export async function setStripeCustomerId(parentId: string, stripeCustomerId: string): Promise<void> {
  await query(`UPDATE parents SET stripe_customer_id = :cid WHERE id = :id`, {
    cid: stripeCustomerId,
    id: parentId,
  })
}

export async function getParentByStripeCustomerId(stripeCustomerId: string): Promise<Parent | null> {
  const row = await queryOne<ParentRow>(
    `SELECT id, email, guardian_attested, age_attested, stripe_customer_id, created_at, deleted_at, has_used_trial
     FROM parents WHERE stripe_customer_id = :cid`,
    { cid: stripeCustomerId },
  )
  return row ? mapParent(row) : null
}

/**
 * Server-only read of the trial flag. Deliberately not part of the client-facing
 * `Parent` type so it can never be serialised to the browser (Req 1.2). Returns
 * `false` when no parent row exists.
 */
export async function getHasUsedTrial(parentId: string): Promise<boolean> {
  const row = await queryOne<{ has_used_trial: boolean }>(
    `SELECT has_used_trial FROM parents WHERE id = :id`,
    { id: parentId },
  )
  return row?.has_used_trial ?? false
}

/**
 * Monotonic latch: marks the trial as used. Only ever sets the flag to TRUE and
 * never resets it to FALSE (Req 3.2). Setting TRUE over TRUE is a no-op, so this
 * is safe to call repeatedly (Req 3.1, 3.3).
 */
export async function setHasUsedTrial(parentId: string): Promise<void> {
  await query(`UPDATE parents SET has_used_trial = TRUE WHERE id = :id`, { id: parentId })
}

/**
 * Hard-delete the parent row (GDPR erasure). FK `ON DELETE CASCADE` removes all
 * owned data (children, sessions, session_answers, progress, subscriptions, and
 * review_reports via sessions) — no soft-delete residue is left (Req 14).
 */
export async function hardDeleteParent(parentId: string): Promise<void> {
  await query(`DELETE FROM parents WHERE id = :id`, { id: parentId })
}
