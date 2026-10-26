import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgEnum, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { ordersTable } from "./orders";
import { productVariantsTable } from "./catalog";

export const stockReservationStatusEnum = pgEnum("store_stock_reservation_status", [
  "reserved",
  "committed",
  "released",
]);

export const stockReservationsTable = pgTable(
  "store_stock_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariantsTable.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    status: stockReservationStatusEnum("status").notNull().default("reserved"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    unique("store_stock_reservations_order_variant_unique").on(table.orderId, table.variantId),
    index("store_stock_reservations_variant_status_idx").on(table.variantId, table.status),
    index("store_stock_reservations_order_idx").on(table.orderId),
  ],
);

export const insertStockReservationSchema = createInsertSchema(stockReservationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStockReservation = z.infer<typeof insertStockReservationSchema>;
export type StockReservation = typeof stockReservationsTable.$inferSelect;
