import { createInsertSchema } from "drizzle-zod";
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { productVariantsTable } from "./catalog";

export const storeRoleEnum = pgEnum("store_role", ["customer", "admin", "operations"]);

export const profilesTable = pgTable(
  "store_profiles",
  {
    userId: text("user_id").primaryKey(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    cpfEncrypted: text("cpf_encrypted"),
    cpfLastFour: text("cpf_last_four"),
    communicationOptIn: boolean("communication_opt_in").notNull().default(false),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    privacyAcceptedAt: timestamp("privacy_accepted_at", { withTimezone: true }),
    role: storeRoleEnum("role").notNull().default("customer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("store_profiles_email_unique").on(table.email), index("store_profiles_role_idx").on(table.role)],
);

export const insertProfileSchema = createInsertSchema(profilesTable).omit({ createdAt: true, updatedAt: true });
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profilesTable.$inferSelect;

export const addressesTable = pgTable(
  "customer_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => profilesTable.userId, { onDelete: "cascade" }),
    label: text("label").notNull().default("Casa"),
    recipientName: text("recipient_name").notNull(),
    phone: text("phone").notNull(),
    postalCode: text("postal_code").notNull(),
    street: text("street").notNull(),
    number: text("number").notNull(),
    complement: text("complement"),
    neighborhood: text("neighborhood").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [index("customer_addresses_user_default_idx").on(table.userId, table.isDefault)],
);

export const insertAddressSchema = createInsertSchema(addressesTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAddress = z.infer<typeof insertAddressSchema>;
export type Address = typeof addressesTable.$inferSelect;

export const cartsTable = pgTable(
  "customer_carts",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => profilesTable.userId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
);

export const cartLinesTable = pgTable(
  "customer_cart_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => cartsTable.userId, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariantsTable.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("customer_cart_lines_user_variant_unique").on(table.userId, table.variantId)],
);

export const insertCartLineSchema = createInsertSchema(cartLinesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCartLine = z.infer<typeof insertCartLineSchema>;
export type CartLine = typeof cartLinesTable.$inferSelect;
