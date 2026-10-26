import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ordersTable, orderLinesTable } from "./orders";
import { productsTable, categoriesTable } from "./catalog";
import { z } from "zod/v4";

export const fiscalModeEnum = pgEnum("store_fiscal_mode", ["manual", "nfeio"]);
export const fiscalDocumentStatusEnum = pgEnum("store_fiscal_document_status", [
  "pending",
  "processing",
  "authorized",
  "rejected",
  "cancelled",
  "exempt",
  "submission_unknown",
]);

export const fiscalSettingsTable = pgTable("store_fiscal_settings", {
  id: text("id").primaryKey().default("default"),
  issuerLegalName: text("issuer_legal_name"),
  issuerTradeName: text("issuer_trade_name"),
  issuerCnpj: text("issuer_cnpj"),
  stateRegistration: text("state_registration"),
  stateTaxId: text("state_tax_id"),
  taxRegime: text("tax_regime"),
  municipalityCode: text("municipality_code"),
  issuerAddress: jsonb("issuer_address").$type<Record<string, string> | null>(),
  defaultCfop: text("default_cfop"),
  invoiceSeries: integer("invoice_series"),
  invoiceDefaults: jsonb("invoice_defaults").$type<Record<string, unknown> | null>(),
  nfeioPaymentMethod: text("nfeio_payment_method"),
  nfeioPaymentType: text("nfeio_payment_type"),
  nfeioPaymentMappingConfirmed: boolean("nfeio_payment_mapping_confirmed").notNull().default(false),
  nfeioTestSetupConfirmed: boolean("nfeio_test_setup_confirmed").notNull().default(false),
  nfeioCertificateConfirmed: boolean("nfeio_certificate_confirmed").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fiscalProductProfilesTable = pgTable(
  "store_fiscal_product_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
    ncm: text("ncm").notNull(),
    origin: text("origin").notNull(),
    unit: text("unit").notNull(),
    taxUnit: text("tax_unit").notNull(),
    cest: text("cest"),
    cfop: text("cfop"),
    taxPayload: jsonb("tax_payload").$type<Record<string, unknown> | null>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("store_fiscal_product_profile_product_unique").on(table.productId)],
);

export const fiscalCategoryRulesTable = pgTable(
  "store_fiscal_category_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id").notNull().references(() => categoriesTable.id, { onDelete: "cascade" }),
    cfop: text("cfop"),
    taxPayload: jsonb("tax_payload").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("store_fiscal_category_rule_category_unique").on(table.categoryId)],
);

export const fiscalRecipientsTable = pgTable(
  "store_fiscal_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => ordersTable.id, { onDelete: "restrict" }),
    taxNumber: text("tax_number").notNull(),
    legalName: text("legal_name").notNull(),
    email: text("email").notNull(),
    address: jsonb("address").$type<Record<string, string | null>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("store_fiscal_recipient_order_unique").on(table.orderId)],
);

export const fiscalDocumentsTable = pgTable(
  "store_fiscal_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => ordersTable.id, { onDelete: "restrict" }),
    mode: fiscalModeEnum("mode").notNull(),
    status: fiscalDocumentStatusEnum("status").notNull().default("pending"),
    environment: text("environment").notNull().default("homologacao"),
    invoiceNumber: text("invoice_number"),
    series: text("series"),
    accessKey: text("access_key"),
    nfeioInvoiceId: text("nfeio_invoice_id"),
    xmlObjectPath: text("xml_object_path"),
    danfeObjectPath: text("danfe_object_path"),
    rejectionReason: text("rejection_reason"),
    exemptionReason: text("exemption_reason"),
    cancellationReason: text("cancellation_reason"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("store_fiscal_document_order_unique").on(table.orderId),
    uniqueIndex("store_fiscal_document_nfeio_id_unique").on(table.nfeioInvoiceId),
    index("store_fiscal_document_status_idx").on(table.status, table.createdAt),
  ],
);

export const fiscalDocumentEventsTable = pgTable(
  "store_fiscal_document_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").references(() => fiscalDocumentsTable.id, { onDelete: "cascade" }),
    providerEventId: text("provider_event_id"),
    dedupeKey: text("dedupe_key"),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    message: text("message"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    processingStatus: text("processing_status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("store_fiscal_event_provider_id_unique").on(table.providerEventId).where(sql`${table.providerEventId} IS NOT NULL`),
    uniqueIndex("store_fiscal_event_dedupe_key_unique").on(table.dedupeKey).where(sql`${table.dedupeKey} IS NOT NULL`),
    index("store_fiscal_event_document_idx").on(table.documentId, table.createdAt),
  ],
);

export const insertFiscalSettingsSchema = createInsertSchema(fiscalSettingsTable).omit({ updatedAt: true });
export const insertFiscalProductProfileSchema = createInsertSchema(fiscalProductProfilesTable).omit({ id: true, updatedAt: true });
export const insertFiscalCategoryRuleSchema = createInsertSchema(fiscalCategoryRulesTable).omit({ id: true, updatedAt: true });
export type FiscalDocument = typeof fiscalDocumentsTable.$inferSelect;
export type FiscalRecipient = typeof fiscalRecipientsTable.$inferSelect;
export type FiscalProductProfile = typeof fiscalProductProfilesTable.$inferSelect;
export type FiscalCategoryRule = typeof fiscalCategoryRulesTable.$inferSelect;
export type FiscalDocumentEvent = typeof fiscalDocumentEventsTable.$inferSelect;
