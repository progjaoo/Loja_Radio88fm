import { createInsertSchema } from "drizzle-zod";
import { bigint, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { profilesTable } from "./accounts";
import { productVariantsTable } from "./catalog";

export const orderStatusEnum = pgEnum("store_order_status", [
  "awaiting_payment",
  "paid",
  "packing",
  "shipped",
  "delivered",
  "picked_up",
  "cancelled",
  "returned",
]);
export const paymentStatusEnum = pgEnum("store_payment_status", ["pending", "paid", "failed", "refunded"]);
export const shippingMethodEnum = pgEnum("store_shipping_method", ["delivery", "pickup"]);

export const ordersTable = pgTable(
  "store_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => profilesTable.userId, { onDelete: "set null" }),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    customerPhone: text("customer_phone"),
    orderNumber: text("order_number").notNull(),
    status: orderStatusEnum("status").notNull().default("awaiting_payment"),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("pending"),
    shippingMethod: shippingMethodEnum("shipping_method").notNull(),
    shippingLabel: text("shipping_label").notNull(),
    shippingAddress: jsonb("shipping_address").$type<Record<string, unknown> | null>(),
    trackingCode: text("tracking_code"),
    shippingServiceId: text("shipping_service_id"),
    shippingCarrier: text("shipping_carrier"),
    shippingDays: integer("shipping_days"),
    shippingQuote: jsonb("shipping_quote").$type<Record<string, unknown> | null>(),
    superfreteLabelId: text("superfrete_label_id"),
    shippingLabelStatus: text("shipping_label_status"),
    shippingLabelAttemptAt: timestamp("shipping_label_attempt_at", { withTimezone: true }),
    stripeSessionId: text("stripe_session_id"),
    stripePaymentId: text("stripe_payment_id"),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
    shippingFeeCents: bigint("shipping_fee_cents", { mode: "number" }).notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    paymentInstructions: text("payment_instructions").notNull(),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    unique("store_orders_order_number_unique").on(table.orderNumber),
    index("store_orders_user_created_idx").on(table.userId, table.createdAt),
    index("store_orders_status_created_idx").on(table.status, table.createdAt),
    unique("store_orders_superfrete_label_unique").on(table.superfreteLabelId),
  ],
);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;

export const orderLinesTable = pgTable(
  "store_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariantsTable.id, { onDelete: "restrict" }),
    productName: text("product_name").notNull(),
    variantName: text("variant_name").notNull(),
    sku: text("sku").notNull(),
    fiscalNcm: text("fiscal_ncm"),
    fiscalOrigin: text("fiscal_origin"),
    fiscalUnit: text("fiscal_unit"),
    fiscalTaxUnit: text("fiscal_tax_unit"),
    fiscalCest: text("fiscal_cest"),
    fiscalCategoryId: text("fiscal_category_id"),
    quantity: integer("quantity").notNull(),
    originalUnitPriceCents: bigint("original_unit_price_cents", { mode: "number" }).notNull().default(0),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull(),
  },
  (table) => [index("store_order_lines_order_idx").on(table.orderId)],
);

export const insertOrderLineSchema = createInsertSchema(orderLinesTable).omit({ id: true });
export type InsertOrderLine = z.infer<typeof insertOrderLineSchema>;
export type OrderLine = typeof orderLinesTable.$inferSelect;

export const paymentsTable = pgTable(
  "store_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    method: text("method").notNull().default("pix_manual"),
    status: paymentStatusEnum("status").notNull().default("pending"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    instruction: text("instruction").notNull(),
    confirmedBy: text("confirmed_by").references(() => profilesTable.userId, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [unique("store_payments_order_unique").on(table.orderId)],
);

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;

export const stockMovementTypeEnum = pgEnum("store_stock_movement_type", [
  "inbound",
  "outbound",
  "manual_adjustment",
  "sale",
  "reservation",
  "cancellation",
  "return",
]);

export const stockMovementsTable = pgTable(
  "store_stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariantsTable.id, { onDelete: "restrict" }),
    actorId: text("actor_id").references(() => profilesTable.userId, { onDelete: "set null" }),
    delta: integer("delta").notNull(),
    reservedDelta: integer("reserved_delta").notNull().default(0),
    movementType: stockMovementTypeEnum("movement_type").notNull().default("manual_adjustment"),
    quantityBefore: integer("quantity_before"),
    quantityAfter: integer("quantity_after"),
    reason: text("reason").notNull(),
    orderId: uuid("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("store_stock_movements_variant_created_idx").on(table.variantId, table.createdAt)],
);

export const insertStockMovementSchema = createInsertSchema(stockMovementsTable).omit({ id: true, createdAt: true });
export type InsertStockMovement = z.infer<typeof insertStockMovementSchema>;
export type StockMovement = typeof stockMovementsTable.$inferSelect;
