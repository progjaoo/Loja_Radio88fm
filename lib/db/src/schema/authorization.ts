import { createInsertSchema } from "drizzle-zod";
import { boolean, index, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { profilesTable } from "./accounts";

export const rolesTable = pgTable(
  "store_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    isSystem: boolean("is_system").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [unique("store_roles_slug_unique").on(table.slug), index("store_roles_active_idx").on(table.active)],
);
export const insertRoleSchema = createInsertSchema(rolesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof rolesTable.$inferSelect;

export const permissionsTable = pgTable(
  "store_permissions",
  {
    key: text("key").primaryKey(),
    resource: text("resource").notNull(),
    action: text("action").notNull(),
    description: text("description").notNull().default(""),
  },
  (table) => [unique("store_permissions_resource_action_unique").on(table.resource, table.action)],
);
export const insertPermissionSchema = createInsertSchema(permissionsTable);
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type Permission = typeof permissionsTable.$inferSelect;

export const rolePermissionsTable = pgTable(
  "store_role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissionsTable.key, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ name: "store_role_permissions_pk", columns: [table.roleId, table.permissionKey] }),
    index("store_role_permissions_permission_idx").on(table.permissionKey),
  ],
);
export const insertRolePermissionSchema = createInsertSchema(rolePermissionsTable);
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;

export const userRolesTable = pgTable(
  "store_user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => profilesTable.userId, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    assignedBy: text("assigned_by").references(() => profilesTable.userId, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "store_user_roles_pk", columns: [table.userId, table.roleId] }),
    index("store_user_roles_role_idx").on(table.roleId),
  ],
);
export const insertUserRoleSchema = createInsertSchema(userRolesTable).omit({ assignedAt: true });
export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;
