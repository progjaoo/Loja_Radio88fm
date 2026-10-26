import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const categoriesTable = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    iconName: text("icon_name").notNull().default("shopping-bag"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("categories_slug_unique").on(table.slug), index("categories_active_idx").on(table.active)],
);

export const insertCategorySchema = createInsertSchema(categoriesTable).omit({ id: true, createdAt: true });
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categoriesTable.$inferSelect;

export const productStatusEnum = pgEnum("store_product_status", ["active", "hidden", "inactive"]);

export const productLinesTable = pgTable(
  "store_product_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [unique("store_product_lines_slug_unique").on(table.slug), index("store_product_lines_active_idx").on(table.active)],
);
export const insertProductLineSchema = createInsertSchema(productLinesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProductLine = z.infer<typeof insertProductLineSchema>;
export type ProductLine = typeof productLinesTable.$inferSelect;

export const productsTable = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url"),
    galleryLayout: text("gallery_layout").$type<"square" | "portrait">().notNull().default("square"),
    categoryId: uuid("category_id").references(() => categoriesTable.id, { onDelete: "set null" }),
    lineId: uuid("line_id").references(() => productLinesTable.id, { onDelete: "set null" }),
    baseSku: text("base_sku"),
    internalCode: text("internal_code"),
    pieceType: text("piece_type"),
    brand: text("brand"),
    material: text("material"),
    ncmSuggestion: text("ncm_suggestion"),
    tags: text("tags").array().notNull().default([]),
    promotionalPriceCents: bigint("promotional_price_cents", { mode: "number" }),
    promotionStartsAt: timestamp("promotion_starts_at", { withTimezone: true }),
    promotionEndsAt: timestamp("promotion_ends_at", { withTimezone: true }),
    featured: boolean("featured").notNull().default(false),
    active: boolean("active").notNull().default(true),
    status: productStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    unique("products_slug_unique").on(table.slug),
    check("products_gallery_layout_check", sql`${table.galleryLayout} in ('square', 'portrait')`),
    index("products_active_featured_idx").on(table.active, table.featured),
    index("products_category_idx").on(table.categoryId),
    index("products_line_idx").on(table.lineId),
    index("products_status_featured_idx").on(table.status, table.featured),
    uniqueIndex("products_base_sku_unique").on(table.baseSku),
    uniqueIndex("products_internal_code_unique").on(table.internalCode),
  ],
);

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;

export const productImagesTable = pgTable(
  "store_product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    alt: text("alt").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
    isHover: boolean("is_hover").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("store_product_images_order_unique").on(table.productId, table.sortOrder),
    uniqueIndex("store_product_images_primary_unique").on(table.productId).where(sql`${table.isPrimary}`),
    uniqueIndex("store_product_images_hover_unique").on(table.productId).where(sql`${table.isHover}`),
    index("store_product_images_product_idx").on(table.productId),
  ],
);
export const insertProductImageSchema = createInsertSchema(productImagesTable).omit({ id: true, createdAt: true });
export type InsertProductImage = z.infer<typeof insertProductImageSchema>;
export type ProductImage = typeof productImagesTable.$inferSelect;

export const productVariantsTable = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    size: text("size"),
    color: text("color"),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    priceCents: bigint("price_cents", { mode: "number" }).notNull(),
    costPriceCents: bigint("cost_price_cents", { mode: "number" }),
    stock: integer("stock").notNull().default(0),
    reservedStock: integer("reserved_stock").notNull().default(0),
    minimumStock: integer("minimum_stock").notNull().default(5),
    weightGrams: integer("weight_grams"),
    dimensionsCm: jsonb("dimensions_cm").$type<{ length: number; width: number; height: number } | null>(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    unique("product_variants_sku_unique").on(table.sku),
    uniqueIndex("product_variants_barcode_unique").on(table.barcode),
    index("product_variants_product_active_idx").on(table.productId, table.active),
    index("product_variants_stock_idx").on(table.stock, table.reservedStock, table.minimumStock),
  ],
);

export const insertProductVariantSchema = createInsertSchema(productVariantsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProductVariant = z.infer<typeof insertProductVariantSchema>;
export type ProductVariant = typeof productVariantsTable.$inferSelect;
