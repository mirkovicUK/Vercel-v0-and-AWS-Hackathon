"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireOnboardedParent } from "@/lib/auth/guard"
import { createChild, softDeleteChild, ChildLimitError } from "@/lib/db/children"
import { audit } from "@/lib/db/audit"
import { YEAR_GROUPS } from "@/lib/domain"

export interface ChildActionState {
  ok: boolean
  error?: string
}

const AVATAR_COLORS = ["teal", "blue", "amber", "rose", "emerald", "indigo"] as const

const createSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Please enter a name or nickname.")
    .max(40, "That name is a bit long — keep it under 40 characters."),
  yearGroup: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z
      .union([
        z.null(),
        z.coerce
          .number()
          .int()
          .refine((n) => (YEAR_GROUPS as readonly number[]).includes(n), {
            message: "Year group must be 4, 5 or 6.",
          }),
      ])
      .transform((v) => (v === null || Number.isNaN(v) ? null : v)),
  ),
  avatarColor: z.enum(AVATAR_COLORS).default("teal"),
})

export async function createChildAction(
  _prev: ChildActionState,
  formData: FormData,
): Promise<ChildActionState> {
  const parent = await requireOnboardedParent()
  const parsed = createSchema.safeParse({
    displayName: formData.get("displayName"),
    yearGroup: formData.get("yearGroup"),
    avatarColor: formData.get("avatarColor") ?? "teal",
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the details." }
  }
  try {
    const child = await createChild({
      parentId: parent.id,
      displayName: parsed.data.displayName,
      yearGroup: parsed.data.yearGroup,
      avatarColor: parsed.data.avatarColor,
    })
    await audit({ action: "child.created", parentId: parent.id, detail: { childId: child.id } })
  } catch (err) {
    if (err instanceof ChildLimitError) return { ok: false, error: err.message }
    return { ok: false, error: "Could not add this child. Please try again." }
  }
  revalidatePath("/dashboard")
  return { ok: true }
}

export async function deleteChildAction(formData: FormData): Promise<void> {
  const parent = await requireOnboardedParent()
  const childId = String(formData.get("childId") ?? "")
  if (!childId) return
  await softDeleteChild(childId, parent.id)
  await audit({ action: "child.deleted", parentId: parent.id, detail: { childId } })
  revalidatePath("/dashboard")
  redirect("/dashboard")
}
