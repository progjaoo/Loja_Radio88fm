import { createInsertSchema } from "drizzle-zod";
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const homepageLayoutTable = pgTable("store_homepage_layout", {
  id: text("id").primaryKey().default("main"),
  config: jsonb("config").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertHomepageLayoutSchema = createInsertSchema(homepageLayoutTable).omit({ updatedAt: true });
export type HomepageLayoutRow = typeof homepageLayoutTable.$inferSelect;
