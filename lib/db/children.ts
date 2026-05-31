import "server-only"
import { query, queryOne } from "@/lib/aws/rds-data"
import { MAX_CHILDREN_PER_PARENT, type Child } from "@/lib/domain"

interface ChildRow {
  id: string
  parent_id: string
  display_name: string
  year_group: number | null
  avatar_color: string
  created_at: string
  deleted_at: string | null
}

function mapChild(row: ChildRow): Child {
  return {
    id: row.id,
    parentId: row.parent_id,
    displayName: row.display_name,
    yearGroup: row.year_group,
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  }
}

const SELECT = `SELECT id, parent_id, display_name, year_group, avatar_color, created_at, deleted_at FROM children`

export async function listChildren(parentId: string): Promise<Child[]> {
  const rows = await query<ChildRow>(
    `${SELECT} WHERE parent_id = :pid AND deleted_at IS NULL ORDER BY created_at ASC`,
    { pid: parentId },
  )
  return rows.map(mapChild)
}

/** Fetch a child, scoped to its parent (prevents cross-account access). */
export async function getChildForParent(childId: string, parentId: string): Promise<Child | null> {
  const row = await queryOne<ChildRow>(
    `${SELECT} WHERE id = :id AND parent_id = :pid AND deleted_at IS NULL`,
    { id: childId, pid: parentId },
  )
  return row ? mapChild(row) : null
}

export async function countChildren(parentId: string): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT count(*)::int AS count FROM children WHERE parent_id = :pid AND deleted_at IS NULL`,
    { pid: parentId },
  )
  return row?.count ?? 0
}

export class ChildLimitError extends Error {
  constructor() {
    super(`A maximum of ${MAX_CHILDREN_PER_PARENT} children is allowed per account.`)
    this.name = "ChildLimitError"
  }
}

export async function createChild(input: {
  parentId: string
  displayName: string
  yearGroup?: number | null
  avatarColor?: string
}): Promise<Child> {
  const existing = await countChildren(input.parentId)
  if (existing >= MAX_CHILDREN_PER_PARENT) throw new ChildLimitError()

  const row = await queryOne<ChildRow>(
    `INSERT INTO children (parent_id, display_name, year_group, avatar_color)
     VALUES (:pid, :name, :year, :color)
     RETURNING id, parent_id, display_name, year_group, avatar_color, created_at, deleted_at`,
    {
      pid: input.parentId,
      name: input.displayName.trim(),
      year: input.yearGroup ?? null,
      color: input.avatarColor ?? "teal",
    },
  )
  return mapChild(row!)
}

export async function softDeleteChild(childId: string, parentId: string): Promise<void> {
  await query(
    `UPDATE children SET deleted_at = now() WHERE id = :id AND parent_id = :pid AND deleted_at IS NULL`,
    { id: childId, pid: parentId },
  )
}
