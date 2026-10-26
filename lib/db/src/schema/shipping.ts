import { createInsertSchema } from "drizzle-zod";
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const shippingSettingsTable = pgTable("store_shipping_settings", {
  id: text("id").primaryKey().default("main"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export const insertShippingSettingsSchema = createInsertSchema(shippingSettingsTable).omit({ updatedAt: true });
export type InsertShippingSettings = z.infer<typeof insertShippingSettingsSchema>;
export type ShippingSettingsRow = typeof shippingSettingsTable.$inferSelect;
