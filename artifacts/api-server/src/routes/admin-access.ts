import { and, asc, count, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  CreateAdminRoleBody,
  CreateAdminRoleResponse,
  GetAdminCapabilitiesResponse,
  ListAdminPermissionsResponse,
  ListAdminRolesResponse,
  ListAdminUsersResponse,
  UpdateAdminRoleBody,
  UpdateAdminRoleParams,
  UpdateAdminRoleResponse,
  UpdateAdminUserRolesBody,
  UpdateAdminUserRolesParams,
  UpdateAdminUserRolesResponse,
  UpdateUserRoleBody,
  UpdateUserRoleParams,
  UpdateUserRoleResponse,
} from "@workspace/api-zod";
import {
  auditEventsTable,
  db,
  permissionsTable,
  profilesTable,
  rolePermissionsTable,
  rolesTable,
  userRolesTable,
} from "@workspace/db";
import { getStoreProfile, requireStoreAuth, requireStorePermission } from "../middlewares/auth";
import { getStorePermissionKeys, getStoreRoleSummaries, isStoreSystemAdmin } from "../lib/rbac";

const router: IRouter = Router();
const protectedPermissionKeys = new Set(["users:manage", "roles:manage"]);

async function serializeRole(role: typeof rolesTable.$inferSelect) {
  const [permissionRows, assignedRows] = await Promise.all([
    db.select({ permissionKey: rolePermissionsTable.permissionKey })
      .from(rolePermissionsTable)
      .where(eq(rolePermissionsTable.roleId, role.id))
      .orderBy(asc(rolePermissionsTable.permissionKey)),
    db.select({ assignedUserCount: count() })
      .from(userRolesTable)
      .where(eq(userRolesTable.roleId, role.id)),
  ]);
  return {
    id: role.id,
    slug: role.slug,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    active: role.active,
    permissionKeys: permissionRows.map(({ permissionKey }) => permissionKey),
    assignedUserCount: Number(assignedRows[0]?.assignedUserCount ?? 0),
  };
}

async function validPermissionKeys(keys: string[]): Promise<boolean> {
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length !== keys.length || keys.some((key) => protectedPermissionKeys.has(key))) return false;
  const existing = await db.select({ key: permissionsTable.key })
    .from(permissionsTable)
    .where(inArray(permissionsTable.key, keys));
  return existing.length === keys.length;
}

async function serializeUser(user: typeof profilesTable.$inferSelect) {
  const [roles, effectivePermissions] = await Promise.all([
    getStoreRoleSummaries(user.userId),
    getStorePermissionKeys(user.userId),
  ]);
  return {
    userId: user.userId,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    roles,
    effectivePermissions,
  };
}

async function replaceUserRoles(userId: string, roleIds: string[], actor: ReturnType<typeof getStoreProfile>) {
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(profilesTable)
      .where(eq(profilesTable.userId, userId))
      .for("update");
    if (!target) return { kind: "user-not-found" as const };

    const uniqueRoleIds = [...new Set(roleIds)];
    if (uniqueRoleIds.length !== roleIds.length) return { kind: "invalid-roles" as const };
    const roles = uniqueRoleIds.length
      ? await tx.select().from(rolesTable)
        .where(and(inArray(rolesTable.id, uniqueRoleIds), eq(rolesTable.active, true)))
        .for("update")
      : [];
    if (roles.length !== uniqueRoleIds.length) return { kind: "invalid-roles" as const };

    const [adminRole] = await tx.select().from(rolesTable)
      .where(and(eq(rolesTable.slug, "admin"), eq(rolesTable.isSystem, true)))
      .for("update");
    if (!adminRole) return { kind: "admin-role-missing" as const };
    const currentAdmins = await tx.select({ userId: userRolesTable.userId })
      .from(userRolesTable)
      .where(eq(userRolesTable.roleId, adminRole.id));
    const hadAdminRole = currentAdmins.some((assignment) => assignment.userId === userId);
    const willHaveAdminRole = roles.some((role) => role.id === adminRole.id);
    if (hadAdminRole && !willHaveAdminRole && currentAdmins.length <= 1) {
      return { kind: "last-admin" as const };
    }

    await tx.delete(userRolesTable).where(eq(userRolesTable.userId, userId));
    if (roles.length) {
      await tx.insert(userRolesTable).values(roles.map((role) => ({
        userId,
        roleId: role.id,
        assignedBy: actor.userId,
      })));
    }
    const legacyRole = roles.some((role) => role.slug === "admin")
      ? "admin"
      : roles.some((role) => role.slug === "stockist")
        ? "operations"
        : "customer";
    const [updated] = await tx.update(profilesTable)
      .set({ role: legacyRole, updatedAt: new Date() })
      .where(eq(profilesTable.userId, userId))
      .returning();
    await tx.insert(auditEventsTable).values({
      actorId: actor.userId,
      actorName: actor.fullName,
      action: "user.roles_updated",
      entityType: "profile",
      entityId: userId,
      details: { roles: roles.map(({ slug, name }) => ({ slug, name })) },
    });
    return { kind: "success" as const, user: updated };
  });
}

async function requireSystemAdmin(res: Response): Promise<boolean> {
  const actor = getStoreProfile(res);
  if (await isStoreSystemAdmin(actor.userId)) return true;
  res.status(403).json({ error: "Apenas um administrador do sistema pode alterar funções ou acessos." });
  return false;
}

router.get(
  "/admin/capabilities",
  requireStoreAuth,
  async (_req, res): Promise<void> => {
    const profile = getStoreProfile(res);
    res.json(GetAdminCapabilitiesResponse.parse({
      permissions: await getStorePermissionKeys(profile.userId),
    }));
  },
);

router.get(
  "/admin/permissions",
  requireStoreAuth,
  requireStorePermission("roles:read"),
  async (_req, res): Promise<void> => {
    const permissions = await db.select().from(permissionsTable)
      .orderBy(asc(permissionsTable.resource), asc(permissionsTable.action));
    res.json(ListAdminPermissionsResponse.parse(permissions));
  },
);

router.get(
  "/admin/roles",
  requireStoreAuth,
  requireStorePermission("roles:read"),
  async (_req, res): Promise<void> => {
    const roles = await db.select().from(rolesTable).orderBy(asc(rolesTable.name));
    const serialized = await Promise.all(roles.map(serializeRole));
    res.json(ListAdminRolesResponse.parse(serialized));
  },
);

router.post(
  "/admin/roles",
  requireStoreAuth,
  requireStorePermission("roles:manage"),
  async (req, res): Promise<void> => {
    if (!(await requireSystemAdmin(res))) return;
    const body = CreateAdminRoleBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    if (!(await validPermissionKeys(body.data.permissionKeys))) {
      res.status(400).json({ error: "Selecione permissões existentes e não administrativas." });
      return;
    }
    const actor = getStoreProfile(res);
    try {
      const created = await db.transaction(async (tx) => {
        const [role] = await tx.insert(rolesTable).values({
          slug: body.data.slug,
          name: body.data.name.trim(),
          description: body.data.description.trim(),
          isSystem: false,
          active: true,
        }).returning();
        await tx.insert(rolePermissionsTable).values(body.data.permissionKeys.map((permissionKey) => ({
          roleId: role.id,
          permissionKey,
        })));
        await tx.insert(auditEventsTable).values({
          actorId: actor.userId,
          actorName: actor.fullName,
          action: "role.created",
          entityType: "store_role",
          entityId: role.id,
          details: { roleName: role.name, permissionCount: body.data.permissionKeys.length },
        });
        return role;
      });
      res.status(201).json(CreateAdminRoleResponse.parse({
        ...created,
        permissionKeys: body.data.permissionKeys,
        assignedUserCount: 0,
      }));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        res.status(409).json({ error: "Já existe uma função com esse identificador." });
        return;
      }
      throw error;
    }
  },
);

router.patch(
  "/admin/roles/:roleId",
  requireStoreAuth,
  requireStorePermission("roles:manage"),
  async (req, res): Promise<void> => {
    if (!(await requireSystemAdmin(res))) return;
    const params = UpdateAdminRoleParams.safeParse(req.params);
    const body = UpdateAdminRoleBody.safeParse(req.body);
    if (!params.success || !body.success || !Object.keys(body.data).length) {
      res.status(400).json({ error: params.error?.message ?? body.error?.message ?? "Informe ao menos um campo." });
      return;
    }
    if (body.data.permissionKeys && !(await validPermissionKeys(body.data.permissionKeys))) {
      res.status(400).json({ error: "Selecione permissões existentes e não administrativas." });
      return;
    }
    const actor = getStoreProfile(res);
    const result = await db.transaction(async (tx) => {
      const [role] = await tx.select().from(rolesTable)
        .where(eq(rolesTable.id, params.data.roleId))
        .for("update");
      if (!role) return { kind: "not-found" as const };
      if (role.isSystem) return { kind: "protected" as const };

      const updates = {
        ...(body.data.name !== undefined ? { name: body.data.name.trim() } : {}),
        ...(body.data.description !== undefined ? { description: body.data.description.trim() } : {}),
        ...(body.data.active !== undefined ? { active: body.data.active } : {}),
        updatedAt: new Date(),
      };
      const [updated] = await tx.update(rolesTable).set(updates)
        .where(eq(rolesTable.id, role.id))
        .returning();
      if (body.data.permissionKeys) {
        await tx.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, role.id));
        await tx.insert(rolePermissionsTable).values(body.data.permissionKeys.map((permissionKey) => ({
          roleId: role.id,
          permissionKey,
        })));
      }
      await tx.insert(auditEventsTable).values({
        actorId: actor.userId,
        actorName: actor.fullName,
        action: "role.updated",
        entityType: "store_role",
        entityId: role.id,
        details: {
          roleName: updated.name,
          changedFields: Object.keys(body.data),
          permissionCount: body.data.permissionKeys?.length,
          active: updated.active,
        },
      });
      return { kind: "success" as const, role: updated };
    });
    if (result.kind === "not-found") {
      res.status(404).json({ error: "Função não encontrada." });
      return;
    }
    if (result.kind === "protected") {
      res.status(400).json({ error: "As funções padrão do sistema não podem ser alteradas." });
      return;
    }
    res.json(UpdateAdminRoleResponse.parse(await serializeRole(result.role)));
  },
);

router.get(
  "/admin/users",
  requireStoreAuth,
  requireStorePermission("users:read"),
  async (_req, res): Promise<void> => {
    const users = await db.select().from(profilesTable).orderBy(asc(profilesTable.createdAt));
    const serialized = await Promise.all(users.map(serializeUser));
    res.json(ListAdminUsersResponse.parse(serialized));
  },
);

router.patch(
  "/admin/users/:userId/roles",
  requireStoreAuth,
  requireStorePermission("users:manage", "roles:manage"),
  async (req, res): Promise<void> => {
    if (!(await requireSystemAdmin(res))) return;
    const params = UpdateAdminUserRolesParams.safeParse(req.params);
    const body = UpdateAdminUserRolesBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: params.error?.message ?? body.error?.message });
      return;
    }
    const result = await replaceUserRoles(params.data.userId, body.data.roleIds, getStoreProfile(res));
    if (result.kind === "user-not-found") {
      res.status(404).json({ error: "Usuário não encontrado." });
      return;
    }
    if (result.kind === "invalid-roles") {
      res.status(404).json({ error: "Uma ou mais funções estão indisponíveis." });
      return;
    }
    if (result.kind === "last-admin") {
      res.status(400).json({ error: "Promova outro administrador antes de remover o último acesso administrativo." });
      return;
    }
    if (result.kind === "admin-role-missing") {
      res.status(503).json({ error: "A função padrão de administrador não está configurada." });
      return;
    }
    res.json(UpdateAdminUserRolesResponse.parse(await serializeUser(result.user)));
  },
);

router.patch(
  "/admin/users/:userId/role",
  requireStoreAuth,
  requireStorePermission("users:manage", "roles:manage"),
  async (req, res): Promise<void> => {
    if (!(await requireSystemAdmin(res))) return;
    const params = UpdateUserRoleParams.safeParse(req.params);
    const body = UpdateUserRoleBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: params.error?.message ?? body.error?.message });
      return;
    }
    const actor = getStoreProfile(res);
    const slug = body.data.role === "admin" ? "admin" : body.data.role === "operations" ? "stockist" : null;
    const [role] = slug
      ? await db.select({ id: rolesTable.id }).from(rolesTable)
        .where(and(eq(rolesTable.slug, slug), eq(rolesTable.active, true)))
        .limit(1)
      : [];
    if (slug && !role) {
      res.status(503).json({ error: "A função padrão solicitada não está configurada." });
      return;
    }
    const result = await replaceUserRoles(params.data.userId, role ? [role.id] : [], actor);
    if (result.kind === "user-not-found") {
      res.status(404).json({ error: "Usuário não encontrado." });
      return;
    }
    if (result.kind === "invalid-roles") {
      res.status(404).json({ error: "A função solicitada não está disponível." });
      return;
    }
    if (result.kind === "last-admin") {
      res.status(400).json({ error: "Promova outro administrador antes de remover o último acesso administrativo." });
      return;
    }
    if (result.kind === "admin-role-missing") {
      res.status(503).json({ error: "A função padrão de administrador não está configurada." });
      return;
    }
    res.json(UpdateUserRoleResponse.parse(await serializeUser(result.user)));
  },
);

export default router;
