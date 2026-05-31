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
    `SELECT id, email, guardian_attested, age_attested, stripe_customer_id, created_at, deleted_at
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
     RETURNING id, email, guardian_attested, age_attested, stripe_customer_id, created_at, deleted_at`,
    {
      id: input.id,
      email: input.email,
      guardian: input.guardianAttested ?? false,
      age: input.ageAttested ?? false,
    },
  )
  return mapParent(row!)
}

export async function setStripeCustomerId(parentId: string, stripeCustomerId: string): Promise<void> {
  await query(`UPDATE parents SET stripe_customer_id = :cid WHERE id = :id`, {
    cid: stripeCustomerId,
    id: parentId,
  })
}

export async function getParentByStripeCustomerId(stripeCustomerId: string): Promise<Parent | null> {
  const row = await queryOne<ParentRow>(
    `SELECT id, email, guardian_attested, age_attested, stripe_customer_id, created_at, deleted_at
     FROM parents WHERE stripe_customer_id = :cid`,
    { cid: stripeCustomerId },
  )
  return row ? mapParent(row) : null
}
