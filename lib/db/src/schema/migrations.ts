import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const schemaMigrationsTable = pgTable("store_schema_migrations", {
  filename: text("filename").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});
