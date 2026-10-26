import { createInsertSchema } from "drizzle-zod";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { profilesTable } from "./accounts";

export const auditEventsTable = pgTable(
  "store_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id").references(() => profilesTable.userId, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("store_audit_events_created_idx").on(table.createdAt)],
);

export const insertAuditEventSchema = createInsertSchema(auditEventsTable).omit({ id: true, createdAt: true });
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEventsTable.$inferSelect;

export const emailOutboxTable = pgTable(
  "store_email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => profilesTable.userId, { onDelete: "set null" }),
    recipient: text("recipient").notNull(),
    eventType: text("event_type").notNull(),
    subject: text("subject").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    index("store_email_outbox_status_created_idx").on(table.status, table.createdAt),
    index("store_email_outbox_retry_idx").on(table.status, table.nextAttemptAt),
  ],
);

export const insertEmailOutboxSchema = createInsertSchema(emailOutboxTable).omit({
  id: true,
  createdAt: true,
  sentAt: true,
});
export type InsertEmailOutbox = z.infer<typeof insertEmailOutboxSchema>;
export type EmailOutbox = typeof emailOutboxTable.$inferSelect;
