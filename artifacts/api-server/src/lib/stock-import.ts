import { and, eq, inArray } from "drizzle-orm";
import { ImportAdminStockCatalogBody } from "@workspace/api-zod";
import {
  auditEventsTable,
  categoriesTable,
  db,
  emailOutboxTable,
  productImagesTable,
  productLinesTable,
  productVariantsTable,
  productsTable,
  profilesTable,
  stockMovementsTable,
} from "@workspace/db";
import { reaisToCents } from "./currency";
import { effectiveVariantPriceCents, isValidPromotionWindow } from "./pricing";
import { buildPriceDropEmailRows } from "./price-drop-notifications";

type ImportRow = (typeof ImportAdminStockCatalogBody)["_output"]["items"][number];
type ProductRow = Pick<
  ImportRow,
  | "productSlug"
  | "productName"
  | "description"
  | "imageUrl"
  | "baseSku"
  | "internalCode"
  | "categorySlug"
  | "lineSlug"
  | "pieceType"
  | "brand"
  | "material"
  | "tags"
  | "promotionalPrice"
  | "promotionStartsAt"
  | "promotionEndsAt"
  | "featured"
  | "status"
>;

type ImportGroup = {
  key: string;
  product: ProductRow;
  rows: ImportRow[];
};

export class StockImportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message);
    this.name = "StockImportError";
  }
}

const PRODUCT_FIELDS: (keyof ProductRow)[] = [
  "productSlug",
  "productName",
  "description",
  "imageUrl",
  "baseSku",
  "internalCode",
  "categorySlug",
  "lineSlug",
  "pieceType",
  "brand",
  "material",
  "tags",
  "promotionalPrice",
  "promotionStartsAt",
  "promotionEndsAt",
  "featured",
  "status",
];

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150);
}

function comparable(value: unknown): string {
  return JSON.stringify(value);
}

function groupImportRows(rows: ImportRow[]): ImportGroup[] {
  const groups = new Map<string, ImportGroup>();
  const skus = new Set<string>();
  const keyByBaseSku = new Map<string, string>();
  const keyBySlug = new Map<string, string>();

  for (const source of rows) {
    const sku = source.sku.trim();
    const baseSku = typeof source.baseSku === "string" ? source.baseSku.trim() : source.baseSku;
    const productSlug = source.productSlug ? slugify(source.productSlug) : undefined;
    if (!sku) throw new StockImportError("Cada variação precisa ter um SKU preenchido.");
    if (skus.has(sku)) throw new StockImportError(`O CSV contém o SKU duplicado ${sku}.`);
    skus.add(sku);
    if (source.productSlug && !productSlug) {
      throw new StockImportError(`O identificador do produto para o SKU ${sku} não é válido.`);
    }

    const key = baseSku
      ? `base:${baseSku}`
      : productSlug
        ? `slug:${productSlug}`
        : undefined;
    if (!key) {
      throw new StockImportError(`Informe SKU base ou slug do produto para agrupar a variação ${sku}.`);
    }
    if (baseSku) {
      const priorKey = keyByBaseSku.get(baseSku);
      if (priorKey && priorKey !== key) throw new StockImportError(`SKU base duplicado: ${baseSku}.`);
      keyByBaseSku.set(baseSku, key);
    }
    if (productSlug) {
      const priorKey = keyBySlug.get(productSlug);
      if (priorKey && priorKey !== key) {
        throw new StockImportError(`O slug ${productSlug} foi informado para mais de um produto.`);
      }
      keyBySlug.set(productSlug, key);
    }

    const row: ImportRow = {
      ...source,
      ...(baseSku !== undefined ? { baseSku } : {}),
      ...(productSlug ? { productSlug } : {}),
      productName: source.productName.trim(),
      variantName: source.variantName.trim(),
      sku,
    };
    const existing = groups.get(key);
    if (!existing) {
      const product = {} as ProductRow;
      for (const field of PRODUCT_FIELDS) {
        const value = row[field];
        if (value !== undefined) Object.assign(product, { [field]: value });
      }
      groups.set(key, { key, product, rows: [row] });
      continue;
    }

    for (const field of PRODUCT_FIELDS) {
      const value = row[field];
      if (value === undefined) continue;
      const prior = existing.product[field];
      if (prior !== undefined && comparable(prior) !== comparable(value)) {
        throw new StockImportError(
          `Os dados do produto precisam ser iguais em todas as linhas do SKU base ${baseSku ?? productSlug}.`,
        );
      }
      Object.assign(existing.product, { [field]: value });
    }
    existing.rows.push(row);
  }

  return [...groups.values()];
}

function toDate(value: Date | null | undefined): Date | null | undefined {
  return value;
}

function toOptionalCents(value: number | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : reaisToCents(value);
}

async function setPrimaryImage(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  productId: string,
  url: string | null,
  alt: string,
): Promise<void> {
  const images = await tx
    .select()
    .from(productImagesTable)
    .where(eq(productImagesTable.productId, productId))
    .for("update");
  const primary = images.find((image) => image.isPrimary);

  if (!url) {
    if (primary) {
      await tx.update(productImagesTable).set({ isPrimary: false }).where(eq(productImagesTable.id, primary.id));
    }
    return;
  }
  if (primary) {
    await tx
      .update(productImagesTable)
      .set({ url, alt })
      .where(eq(productImagesTable.id, primary.id));
    return;
  }
  const sortOrder = images.reduce((max, image) => Math.max(max, image.sortOrder), -1) + 1;
  await tx.insert(productImagesTable).values({ productId, url, alt, sortOrder, isPrimary: true });
}

export async function importStockCatalog(items: ImportRow[], actor: { userId: string; fullName: string }) {
  const groups = groupImportRows(items);
  const allSkus = groups.flatMap((group) => group.rows.map((row) => row.sku));
  const baseSkus = groups
    .map((group) => group.product.baseSku)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const internalCodes = [
    ...new Set(
      groups
        .map((group) => group.product.internalCode)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim()),
    ),
  ];
  const productSlugs = groups
    .map((group) => group.product.productSlug)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const categorySlugs = [
    ...new Set(
      groups
        .map((group) => group.product.categorySlug)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];
  const lineSlugs = [
    ...new Set(
      groups
        .map((group) => group.product.lineSlug)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];

  return db.transaction(async (tx) => {
    const existingProductsByBase = baseSkus.length
      ? await tx.select().from(productsTable).where(inArray(productsTable.baseSku, baseSkus)).for("update")
      : [];
    const existingProductsByInternalCode = internalCodes.length
      ? await tx.select().from(productsTable).where(inArray(productsTable.internalCode, internalCodes)).for("update")
      : [];
    const existingProductsBySlug = productSlugs.length
      ? await tx.select().from(productsTable).where(inArray(productsTable.slug, productSlugs)).for("update")
      : [];
    const existingVariants = await tx
      .select()
      .from(productVariantsTable)
      .where(inArray(productVariantsTable.sku, allSkus))
      .for("update");
    const categories = categorySlugs.length
      ? await tx.select().from(categoriesTable).where(inArray(categoriesTable.slug, categorySlugs))
      : [];
    const lines = lineSlugs.length
      ? await tx.select().from(productLinesTable).where(inArray(productLinesTable.slug, lineSlugs))
      : [];

    const productsByBase = new Map(existingProductsByBase.flatMap((product) => product.baseSku ? [[product.baseSku, product] as const] : []));
    const productsByInternalCode = new Map(
      existingProductsByInternalCode.flatMap((product) =>
        product.internalCode ? [[product.internalCode, product] as const] : [],
      ),
    );
    const productsBySlug = new Map(existingProductsBySlug.map((product) => [product.slug, product] as const));
    const variantsBySku = new Map(existingVariants.map((variant) => [variant.sku, variant] as const));
    const categoriesBySlug = new Map(categories.map((category) => [category.slug, category] as const));
    const linesBySlug = new Map(lines.map((line) => [line.slug, line] as const));

    const counts = {
      productsCreated: 0,
      productsUpdated: 0,
      variantsCreated: 0,
      variantsUpdated: 0,
      stockAdjusted: 0,
    };

    for (const group of groups) {
      const baseSku = typeof group.product.baseSku === "string" ? group.product.baseSku.trim() : null;
      const importedSlug = group.product.productSlug;
      const byBase = baseSku ? productsByBase.get(baseSku) : undefined;
      const bySlug = importedSlug ? productsBySlug.get(importedSlug) : undefined;
      if (byBase && bySlug && byBase.id !== bySlug.id) {
        throw new StockImportError(
          `O SKU base ${baseSku} e o slug ${importedSlug} apontam para produtos diferentes.`,
          409,
        );
      }
      const matchedProduct = byBase ?? bySlug;
      const effectiveStatus = group.product.status ?? matchedProduct?.status ?? "active";
      const startsAt = group.product.promotionStartsAt !== undefined
        ? group.product.promotionStartsAt
        : matchedProduct?.promotionStartsAt ?? null;
      const endsAt = group.product.promotionEndsAt !== undefined
        ? group.product.promotionEndsAt
        : matchedProduct?.promotionEndsAt ?? null;
      if (!isValidPromotionWindow(startsAt, endsAt)) {
        throw new StockImportError(`A janela promocional do produto ${group.product.productName} é inválida.`);
      }

      let categoryId: string | null | undefined;
      if (group.product.categorySlug !== undefined) {
        const slug = group.product.categorySlug?.trim() || null;
        if (slug && !categoriesBySlug.has(slug)) {
          throw new StockImportError(`A categoria "${slug}" não existe.`);
        }
        categoryId = slug ? categoriesBySlug.get(slug)!.id : null;
      }
      let lineId: string | null | undefined;
      if (group.product.lineSlug !== undefined) {
        const slug = group.product.lineSlug?.trim() || null;
        if (slug && !linesBySlug.has(slug)) throw new StockImportError(`A linha "${slug}" não existe.`);
        lineId = slug ? linesBySlug.get(slug)!.id : null;
      }

      if (matchedProduct) {
        const beforeVariants = await tx
          .select()
          .from(productVariantsTable)
          .where(eq(productVariantsTable.productId, matchedProduct.id))
          .for("update");
        if (baseSku && productsByBase.has(baseSku) && productsByBase.get(baseSku)!.id !== matchedProduct.id) {
          throw new StockImportError(`O SKU base ${baseSku} já pertence a outro produto.`, 409);
        }
        const nextBaseSku =
          group.product.baseSku !== undefined
            ? (group.product.baseSku?.trim() || null)
            : matchedProduct.baseSku;
        if (nextBaseSku) {
          const otherProduct = productsByBase.get(nextBaseSku);
          if (otherProduct && otherProduct.id !== matchedProduct.id) {
            throw new StockImportError(`O SKU base ${nextBaseSku} já pertence a outro produto.`, 409);
          }
        }
        const nextInternalCode =
          group.product.internalCode !== undefined
            ? (group.product.internalCode?.trim() || null)
            : matchedProduct.internalCode;
        if (nextInternalCode) {
          const otherProduct = productsByInternalCode.get(nextInternalCode);
          if (otherProduct && otherProduct.id !== matchedProduct.id) {
            throw new StockImportError(`O código interno ${nextInternalCode} já pertence a outro produto.`, 409);
          }
        }
        if (matchedProduct.baseSku && matchedProduct.baseSku !== nextBaseSku) {
          productsByBase.delete(matchedProduct.baseSku);
        }
        if (matchedProduct.internalCode && matchedProduct.internalCode !== nextInternalCode) {
          productsByInternalCode.delete(matchedProduct.internalCode);
        }
        const patch: Partial<typeof productsTable.$inferInsert> = {
          name: group.product.productName,
          ...(group.product.description !== undefined ? { description: group.product.description } : {}),
          ...(group.product.imageUrl !== undefined ? { imageUrl: group.product.imageUrl } : {}),
          ...(group.product.baseSku !== undefined ? { baseSku: nextBaseSku } : {}),
          ...(group.product.internalCode !== undefined ? { internalCode: nextInternalCode } : {}),
          ...(group.product.categorySlug !== undefined ? { categoryId: categoryId ?? null } : {}),
          ...(group.product.lineSlug !== undefined ? { lineId: lineId ?? null } : {}),
          ...(group.product.pieceType !== undefined ? { pieceType: group.product.pieceType?.trim() || null } : {}),
          ...(group.product.brand !== undefined ? { brand: group.product.brand?.trim() || null } : {}),
          ...(group.product.material !== undefined ? { material: group.product.material?.trim() || null } : {}),
          ...(group.product.tags !== undefined ? { tags: group.product.tags } : {}),
          ...(group.product.promotionalPrice !== undefined
            ? { promotionalPriceCents: toOptionalCents(group.product.promotionalPrice)! }
            : {}),
          ...(group.product.promotionStartsAt !== undefined
            ? { promotionStartsAt: toDate(group.product.promotionStartsAt)! }
            : {}),
          ...(group.product.promotionEndsAt !== undefined
            ? { promotionEndsAt: toDate(group.product.promotionEndsAt)! }
            : {}),
          ...(group.product.featured !== undefined ? { featured: group.product.featured } : {}),
          ...(group.product.status !== undefined
            ? { status: group.product.status, active: group.product.status === "active" }
            : {}),
          updatedAt: new Date(),
        };
        const [updatedProduct] = await tx
          .update(productsTable)
          .set(patch)
          .where(eq(productsTable.id, matchedProduct.id))
          .returning();
        productsBySlug.set(updatedProduct.slug, updatedProduct);
        if (updatedProduct.baseSku) productsByBase.set(updatedProduct.baseSku, updatedProduct);
        if (updatedProduct.internalCode) productsByInternalCode.set(updatedProduct.internalCode, updatedProduct);
        if (group.product.imageUrl !== undefined) {
          await setPrimaryImage(tx, updatedProduct.id, group.product.imageUrl, updatedProduct.name);
        }
        counts.productsUpdated += 1;
        let productRecord = updatedProduct;
        for (const row of group.rows) {
          await upsertVariant(tx, productRecord, row, variantsBySku, actor.userId, counts);
        }
        if (
          matchedProduct.active &&
          matchedProduct.status === "active" &&
          updatedProduct.active &&
          updatedProduct.status === "active"
        ) {
          const afterVariants = await tx
            .select()
            .from(productVariantsTable)
            .where(eq(productVariantsTable.productId, updatedProduct.id));
          const pricingNow = new Date();
          const afterById = new Map(afterVariants.map((variant) => [variant.id, variant]));
          const priceDrop = beforeVariants
            .filter((variant) => variant.active)
            .flatMap((variant) => {
              const current = afterById.get(variant.id);
              if (!current?.active) return [];
              const previous = effectiveVariantPriceCents(matchedProduct, variant.priceCents, pricingNow);
              const next = effectiveVariantPriceCents(updatedProduct, current.priceCents, pricingNow);
              return next < previous ? [{ name: current.name, previous, current: next }] : [];
            })
            .sort((a, b) => (b.previous - b.current) - (a.previous - a.current))[0];
          if (priceDrop) {
            const subscribers = await tx
              .select({ userId: profilesTable.userId, email: profilesTable.email })
              .from(profilesTable)
              .where(eq(profilesTable.communicationOptIn, true));
            const notifications = buildPriceDropEmailRows(
              subscribers,
              updatedProduct.name,
              priceDrop.previous,
              priceDrop.current,
              priceDrop.name,
            );
            if (notifications.length) await tx.insert(emailOutboxTable).values(notifications);
          }
        }
      } else {
        const requestedSlug = importedSlug || `${slugify(group.product.productName)}-${slugify(baseSku ?? group.rows[0].sku)}`;
        const slugBase = slugify(requestedSlug);
        let slug = slugBase;
        if (!slug) throw new StockImportError(`Não foi possível gerar um slug para ${group.product.productName}.`);
        let suffix = 2;
        while (
          productsBySlug.has(slug) ||
          (await tx.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, slug))).length
        ) {
          slug = `${slugBase.slice(0, 140)}-${suffix++}`;
        }
        const internalCode = group.product.internalCode?.trim() || null;
        if (internalCode && productsByInternalCode.has(internalCode)) {
          throw new StockImportError(`O código interno ${internalCode} já pertence a outro produto.`, 409);
        }
        const [createdProduct] = await tx
          .insert(productsTable)
          .values({
            name: group.product.productName,
            slug,
            description: group.product.description ?? "",
            imageUrl: group.product.imageUrl ?? null,
            categoryId: categoryId ?? null,
            lineId: lineId ?? null,
            baseSku,
            internalCode,
            pieceType: group.product.pieceType?.trim() || null,
            brand: group.product.brand?.trim() || null,
            material: group.product.material?.trim() || null,
            tags: group.product.tags ?? [],
            promotionalPriceCents: toOptionalCents(group.product.promotionalPrice) ?? null,
            promotionStartsAt: toDate(group.product.promotionStartsAt) ?? null,
            promotionEndsAt: toDate(group.product.promotionEndsAt) ?? null,
            featured: group.product.featured ?? false,
            status: effectiveStatus,
            active: effectiveStatus === "active",
          })
          .returning();
        productsBySlug.set(createdProduct.slug, createdProduct);
        if (createdProduct.baseSku) productsByBase.set(createdProduct.baseSku, createdProduct);
        if (createdProduct.internalCode) productsByInternalCode.set(createdProduct.internalCode, createdProduct);
        if (createdProduct.imageUrl) {
          await setPrimaryImage(tx, createdProduct.id, createdProduct.imageUrl, createdProduct.name);
        }
        counts.productsCreated += 1;
        for (const row of group.rows) {
          await upsertVariant(tx, createdProduct, row, variantsBySku, actor.userId, counts);
        }
      }
    }

    await tx.insert(auditEventsTable).values({
      actorId: actor.userId,
      actorName: actor.fullName,
      action: "stock.csv_imported",
      entityType: "inventory",
      entityId: "bulk",
      details: counts,
    });

    return counts;
  });
}

async function upsertVariant(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  product: typeof productsTable.$inferSelect,
  row: ImportRow,
  variantsBySku: Map<string, typeof productVariantsTable.$inferSelect>,
  actorId: string,
  counts: { variantsCreated: number; variantsUpdated: number; stockAdjusted: number },
): Promise<void> {
  const current = variantsBySku.get(row.sku);
  if (current && current.productId !== product.id) {
    throw new StockImportError(`O SKU ${row.sku} já pertence a outro produto.`, 409);
  }
  const availableBefore = current ? current.stock - current.reservedStock : 0;
  const reservedStock = current?.reservedStock ?? 0;
  const delta = row.availableStock - availableBefore;
  const stock = row.availableStock + reservedStock;
  const shared = {
    name: row.variantName,
    priceCents: reaisToCents(row.price),
    stock,
    updatedAt: new Date(),
    ...(row.minimumStock !== undefined ? { minimumStock: row.minimumStock } : {}),
    ...(row.barcode !== undefined ? { barcode: row.barcode?.trim() || null } : {}),
    ...(row.size !== undefined ? { size: row.size?.trim() || null } : {}),
    ...(row.color !== undefined ? { color: row.color?.trim() || null } : {}),
    ...(row.attributes !== undefined ? { attributes: row.attributes } : {}),
    ...(row.costPrice !== undefined ? { costPriceCents: toOptionalCents(row.costPrice)! } : {}),
    ...(row.weightGrams !== undefined ? { weightGrams: row.weightGrams } : {}),
    ...(row.dimensionsCm !== undefined ? { dimensionsCm: row.dimensionsCm } : {}),
    ...(row.variantActive !== undefined ? { active: row.variantActive } : {}),
  };

  let variantId: string;
  if (current) {
    const [updatedVariant] = await tx
      .update(productVariantsTable)
      .set(shared)
      .where(eq(productVariantsTable.id, current.id))
      .returning();
    variantsBySku.set(updatedVariant.sku, updatedVariant);
    variantId = updatedVariant.id;
    counts.variantsUpdated += 1;
  } else {
    const [createdVariant] = await tx
      .insert(productVariantsTable)
      .values({
        productId: product.id,
        sku: row.sku,
        minimumStock: row.minimumStock ?? 5,
        barcode: row.barcode?.trim() || null,
        size: row.size?.trim() || null,
        color: row.color?.trim() || null,
        attributes: row.attributes ?? {},
        costPriceCents: toOptionalCents(row.costPrice) ?? null,
        weightGrams: row.weightGrams ?? null,
        dimensionsCm: row.dimensionsCm ?? null,
        active: row.variantActive ?? true,
        ...shared,
      })
      .returning();
    variantsBySku.set(createdVariant.sku, createdVariant);
    variantId = createdVariant.id;
    counts.variantsCreated += 1;
  }

  if (delta !== 0) {
    await tx.insert(stockMovementsTable).values({
      variantId,
      actorId,
      delta,
      movementType: "manual_adjustment",
      quantityBefore: current?.stock ?? 0,
      quantityAfter: stock,
      reason: "Importação CSV de produtos e estoque",
    });
    counts.stockAdjusted += 1;
  }
}
