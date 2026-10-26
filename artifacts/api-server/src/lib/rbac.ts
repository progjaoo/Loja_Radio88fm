import { and, eq } from "drizzle-orm";
import {
  db,
  rolesTable,
  rolePermissionsTable,
  userRolesTable,
  type Profile,
} from "@workspace/db";

export type StoreRoleSummary = {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
  active: boolean;
};

export async function getStorePermissionKeys(userId: string): Promise<string[]> {
  const rows = await db
    .select({ key: rolePermissionsTable.permissionKey })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .innerJoin(rolePermissionsTable, eq(rolesTable.id, rolePermissionsTable.roleId))
    .where(and(eq(userRolesTable.userId, userId), eq(rolesTable.active, true)));
  return [...new Set(rows.map(({ key }) => key))].sort();
}

export async function getStoreRoleSummaries(userId: string): Promise<StoreRoleSummary[]> {
  return db
    .select({
      id: rolesTable.id,
      slug: rolesTable.slug,
      name: rolesTable.name,
      isSystem: rolesTable.isSystem,
      active: rolesTable.active,
    })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .where(eq(userRolesTable.userId, userId))
    .orderBy(rolesTable.name);
}

export async function isStoreSystemAdmin(userId: string): Promise<boolean> {
  const [role] = await db
    .select({ id: rolesTable.id })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .where(and(
      eq(userRolesTable.userId, userId),
      eq(rolesTable.slug, "admin"),
      eq(rolesTable.isSystem, true),
      eq(rolesTable.active, true),
    ))
    .limit(1);
  return Boolean(role);
}

export async function ensureLegacyStoreRole(profile: Profile): Promise<void> {
  const slug = profile.role === "admin" ? "admin" : profile.role === "operations" ? "stockist" : null;
  if (!slug) return;

  const [role] = await db
    .select({ id: rolesTable.id })
    .from(rolesTable)
    .where(and(eq(rolesTable.slug, slug), eq(rolesTable.active, true)))
    .limit(1);
  if (!role) throw new Error(`The required built-in store role "${slug}" is missing or inactive.`);

  await db
    .insert(userRolesTable)
    .values({ userId: profile.userId, roleId: role.id })
    .onConflictDoNothing();
}
