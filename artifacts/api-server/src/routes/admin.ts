import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  AdjustStockBody,
  AdjustStockParams,
  AdjustStockResponse,
  ArchiveProductParams,
  ArchiveProductResponse,
  CreateCategoryBody,
  CreateCategoryResponse,
  DeleteCategoryBody,
  DeleteCategoryParams,
  DeleteCategoryResponse,
  CreateProductBody,
  CreateProductResponse,
  CreateProductVariantBody,
  CreateProductVariantParams,
  CreateProductVariantResponse,
  CreateProductLineBody,
  CreateProductLineResponse,
  GetAdminSummaryResponse,
  ListAdminProductLinesResponse,
  ListAdminOrdersQueryParams,
  ListAdminOrdersResponse,
  ListAdminProductsResponse,
  ListAuditEventsResponse,
  UpdateOrderStatusBody,
  UpdateOrderStatusParams,
  UpdateOrderStatusResponse,
  UpdateProductBody,
  UpdateProductParams,
  UpdateProductResponse,
  UpdateProductVariantBody,
  UpdateProductVariantParams,
  UpdateProductVariantResponse,
  UpdateProductLineBody,
  UpdateProductLineParams,
  UpdateProductLineResponse,
  ArchiveProductLineParams,
  ArchiveProductLineResponse,
  ArchiveProductLineBody,
  BulkUpdateProductStatusBody,
  BulkUpdateProductStatusResponse,
  UpdateCategoryBody,
  UpdateCategoryParams,
  UpdateCategoryResponse,
  ListAdminCategoriesResponse,
} from "@workspace/api-zod";
import {
  auditEventsTable,
  categoriesTable,
  db,
  emailOutboxTable,
  orderLinesTable,
  ordersTable,
  paymentsTable,
  productVariantsTable,
  productLinesTable,
  productImagesTable,
  productsTable,
  profilesTable,
  stockReservationsTable,
  stockMovementsTable,
} from "@workspace/db";
import { getOrders, serializeOrder } from "../lib/orders";
import { getProductById, getProducts, serializeProduct } from "../lib/serializers";
import { getStoreProfile, requireStoreAuth, requireStorePermission } from "../middlewares/auth";
import { getStorePermissionKeys } from "../lib/rbac";
import { centsToReais, reaisToCents } from "../lib/currency";
import { effectiveVariantPriceCents, isValidPromotionWindow } from "../lib/pricing";
import { buildPriceDropEmailRows } from "../lib/price-drop-notifications";
import { getPrimaryImageUrl, normalizeProductImages, type ProductImageDraft } from "../lib/product-images";
import { publishOrderUpdated, publishProductUpdated, publishProductsUpdated, publishStockChanged } from "../lib/realtime";

const router: IRouter = Router();

router.get("/admin/summary", requireStoreAuth, requireStorePermission("orders:read", "payments:read", "inventory:read"), async (_req, res): Promise<void> => {
  const now = new Date();
  const brazilDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const startOfBrazilDay = new Date(`${brazilDate}T03:00:00.000Z`);
  const [ordersToday, allOrders, lowStock, recent] = await Promise.all([
    db.select({ id: ordersTable.id }).from(ordersTable).where(gte(ordersTable.createdAt, startOfBrazilDay)),
    db.select({ totalCents: ordersTable.totalCents, paymentStatus: ordersTable.paymentStatus, status: ordersTable.status }).from(ordersTable),
    db
      .select({ id: productVariantsTable.id })
      .from(productVariantsTable)
      .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
      .where(
        and(
          eq(productVariantsTable.active, true),
          eq(productsTable.active, true),
          sql`${productVariantsTable.stock} - ${productVariantsTable.reservedStock} <= ${productVariantsTable.minimumStock}`,
        ),
      ),
    db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(5),
  ]);
  const recentOrders = recent.length
    ? await (async () => {
        const lines = await db
          .select()
          .from(orderLinesTable)
          .where(inArray(orderLinesTable.orderId, recent.map((order) => order.id)));
        const linesByOrder = new Map<string, typeof lines>();
        for (const line of lines) {
          const existing = linesByOrder.get(line.orderId) ?? [];
          existing.push(line);
          linesByOrder.set(line.orderId, existing);
        }
        return recent.map((order) => ({ ...order, lines: linesByOrder.get(order.id) ?? [] }));
      })()
    : [];
  const paidRevenueCents = allOrders.reduce(
    (sum, order) => sum + (order.paymentStatus === "paid" ? order.totalCents : 0),
    0,
  );
  res.json(
    GetAdminSummaryResponse.parse({
      ordersToday: ordersToday.length,
      pendingPayment: allOrders.filter((order) => order.status === "awaiting_payment" && order.paymentStatus === "pending").length,
      openOrders: allOrders.filter((order) => ["awaiting_payment", "paid", "packing", "shipped"].includes(order.status)).length,
      lowStockVariants: lowStock.length,
      grossSales: centsToReais(paidRevenueCents),
      recentOrders: recentOrders.map(serializeOrder),
    }),
  );
});

router.get("/admin/products", requireStoreAuth, requireStorePermission("products:read"), async (_req, res): Promise<void> => {
  const products = await getProducts(true);
  res.json(ListAdminProductsResponse.parse(products.map(serializeProduct)));
});

router.get("/admin/categories", requireStoreAuth, requireStorePermission("categories:read"), async (_req, res): Promise<void> => {
  const categories = await db.select().from(categoriesTable).orderBy(asc(categoriesTable.name));
  res.json(
    ListAdminCategoriesResponse.parse(
      categories.map((category) => ({ ...category, createdAt: category.createdAt.toISOString() })),
    ),
  );
});

router.get("/admin/product-lines", requireStoreAuth, requireStorePermission("product_lines:read"), async (_req, res): Promise<void> => {
  const lines = await db.select().from(productLinesTable).orderBy(asc(productLinesTable.name));
  res.json(
    ListAdminProductLinesResponse.parse(
      lines.map((line) => ({ ...line, createdAt: line.createdAt.toISOString() })),
    ),
  );
});

router.post("/admin/product-lines", requireStoreAuth, requireStorePermission("product_lines:manage"), async (req, res): Promise<void> => {
  const body = CreateProductLineBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [line] = await db
    .insert(productLinesTable)
    .values({ name: body.data.name, slug: createSlug(body.data.name), description: body.data.description ?? "" })
    .returning();
  await db.insert(auditEventsTable).values({
    actorId: profile.userId,
    actorName: profile.fullName,
    action: "product_line.created",
    entityType: "product_line",
    entityId: line.id,
    details: { name: line.name },
  });
  res.status(201).json(CreateProductLineResponse.parse({ ...line, createdAt: line.createdAt.toISOString() }));
});

router.patch("/admin/product-lines/:lineId", requireStoreAuth, requireStorePermission("product_lines:manage"), async (req, res): Promise<void> => {
  const params = UpdateProductLineParams.safeParse(req.params);
  const body = UpdateProductLineBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [line] = await db
    .update(productLinesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(productLinesTable.id, params.data.lineId))
    .returning();
  if (!line) {
    res.status(404).json({ error: "Product line not found." });
    return;
  }
  await db.insert(auditEventsTable).values({
    actorId: profile.userId,
    actorName: profile.fullName,
    action: "product_line.updated",
    entityType: "product_line",
    entityId: line.id,
    details: { changedFields: Object.keys(body.data) },
  });
  res.json(UpdateProductLineResponse.parse({ ...line, createdAt: line.createdAt.toISOString() }));
});

router.delete("/admin/product-lines/:lineId", requireStoreAuth, requireStorePermission("product_lines:manage"), async (req, res): Promise<void> => {
  const params = ArchiveProductLineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let reassignToLineId: string | undefined;
  if (req.body !== undefined && req.body !== null) {
    const body = ArchiveProductLineBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    reassignToLineId = body.data.reassignToLineId;
  }
  const profile = getStoreProfile(res);
  const result = await db.transaction(async (tx) => {
    const [line] = await tx.select().from(productLinesTable).where(eq(productLinesTable.id, params.data.lineId)).limit(1);
    if (!line) return { kind: "not-found" as const };

    const linked = await tx
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.lineId, line.id))
      .limit(1);
    if (linked.length && !reassignToLineId) return { kind: "reassignment-required" as const };
    if (reassignToLineId === line.id) return { kind: "invalid-target" as const };
    if (reassignToLineId) {
      const [target] = await tx
        .select({ id: productLinesTable.id })
        .from(productLinesTable)
        .where(and(eq(productLinesTable.id, reassignToLineId), eq(productLinesTable.active, true)))
        .limit(1);
      if (!target) return { kind: "invalid-target" as const };
      await tx
        .update(productsTable)
        .set({ lineId: target.id, updatedAt: new Date() })
        .where(eq(productsTable.lineId, line.id));
    }

    await tx
      .update(productLinesTable)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(productLinesTable.id, line.id));
    await tx.insert(auditEventsTable).values({
      actorId: profile.userId,
      actorName: profile.fullName,
      action: "product_line.archived",
      entityType: "product_line",
      entityId: line.id,
      details: { name: line.name, reassignToLineId: reassignToLineId ?? null },
    });
    return { kind: "archived" as const };
  });
  if (result.kind === "not-found") {
    res.status(404).json({ error: "Product line not found." });
    return;
  }
  if (result.kind === "reassignment-required") {
    res.status(409).json({ error: "Reassign the linked products before archiving this product line." });
    return;
  }
  if (result.kind === "invalid-target") {
    res.status(400).json({ error: "Choose a different active product line for reassignment." });
    return;
  }
  res.status(204).send(ArchiveProductLineResponse.parse(undefined));
});

router.post("/admin/products", requireStoreAuth, requireStorePermission("products:create"), async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  if (parsed.data.categoryId) {
    const [category] = await db
      .select({ id: categoriesTable.id })
      .from(categoriesTable)
      .where(and(eq(categoriesTable.id, parsed.data.categoryId), eq(categoriesTable.active, true)));
    if (!category) {
      res.status(400).json({ error: "A categoria selecionada não está disponível." });
      return;
    }
  }
  const requestedSkus = parsed.data.variants.map((variant) => variant.sku.trim());
  if (new Set(requestedSkus).size !== requestedSkus.length) {
    res.status(400).json({ error: "Cada variação precisa ter um SKU diferente." });
    return;
  }
  const existingSkus = await db
    .select({ sku: productVariantsTable.sku })
    .from(productVariantsTable)
    .where(inArray(productVariantsTable.sku, requestedSkus));
  if (existingSkus.length) {
    res.status(409).json({ error: `SKU já cadastrado: ${existingSkus[0].sku}.` });
    return;
  }
  if (parsed.data.lineId) {
    const [line] = await db
      .select({ id: productLinesTable.id })
      .from(productLinesTable)
      .where(and(eq(productLinesTable.id, parsed.data.lineId), eq(productLinesTable.active, true)));
    if (!line) {
      res.status(400).json({ error: "A linha selecionada não está disponível." });
      return;
    }
  }
  const images = normalizeProductImages(parsed.data.images, parsed.data.imageUrl, parsed.data.name);
  if (images === null) {
    res.status(400).json({ error: "A galeria aceita até cinco fotos, com ordens únicas e no máximo uma capa e uma foto de hover." });
    return;
  }
  const productImages = images ?? [];
  const status = parsed.data.status ?? "active";
  if (!isValidPromotionWindow(parsed.data.promotionStartsAt, parsed.data.promotionEndsAt)) {
    res.status(400).json({ error: "O fim da promoção precisa ser posterior ao início." });
    return;
  }

  const productId = await db.transaction(async (tx) => {
    const [product] = await tx
      .insert(productsTable)
      .values({
        name: parsed.data.name,
        slug: createSlug(parsed.data.name),
        description: parsed.data.description,
        imageUrl: getPrimaryImageUrl(productImages),
        galleryLayout: parsed.data.galleryLayout ?? "square",
        categoryId: parsed.data.categoryId ?? null,
        lineId: parsed.data.lineId ?? null,
        baseSku: parsed.data.baseSku?.trim() || null,
        internalCode: parsed.data.internalCode?.trim() || null,
        pieceType: parsed.data.pieceType?.trim() || null,
        brand: parsed.data.brand?.trim() || null,
        material: parsed.data.material?.trim() || null,
        ncmSuggestion: parsed.data.ncmSuggestion ?? null,
        tags: parsed.data.tags ?? [],
        promotionalPriceCents:
          parsed.data.promotionalPrice == null ? null : reaisToCents(parsed.data.promotionalPrice),
        promotionStartsAt: parsed.data.promotionStartsAt ?? null,
        promotionEndsAt: parsed.data.promotionEndsAt ?? null,
        featured: parsed.data.featured,
        status,
        active: status === "active",
      })
      .returning();
    if (productImages.length) {
      await tx.insert(productImagesTable).values(
        productImages.map((image) => ({
          productId: product.id,
          url: image.url,
          alt: image.alt,
          sortOrder: image.sortOrder,
          isPrimary: image.isPrimary,
          isHover: image.isHover,
        })),
      );
    }
    await tx.insert(productVariantsTable).values(
      parsed.data.variants.map((variant) => ({
        productId: product.id,
        name: variant.name,
        sku: variant.sku.trim(),
        barcode: variant.barcode?.trim() || null,
        size: variant.size?.trim() || null,
        color: variant.color?.trim() || null,
        attributes: variant.attributes ?? {},
        priceCents: reaisToCents(variant.price),
        costPriceCents: variant.costPrice == null ? null : reaisToCents(variant.costPrice),
        stock: variant.stock,
        minimumStock: variant.minimumStock ?? variant.lowStockThreshold,
        weightGrams: variant.weightGrams ?? null,
        dimensionsCm: variant.dimensionsCm ?? null,
        active: variant.active ?? true,
      })),
    );
    await tx.insert(auditEventsTable).values({
      actorId: profile.userId,
      actorName: profile.fullName,
      action: "product.created",
      entityType: "product",
      entityId: product.id,
      details: { name: product.name, variants: parsed.data.variants.length },
    });
    return product.id;
  });
  const product = await getProductById(productId, true);
  if (!product) throw new Error("New product could not be loaded.");
  publishProductUpdated(product.id);
  void publishStockChanged(product.variants.map((variant) => variant.id));
  res.status(201).json(CreateProductResponse.parse(serializeProduct(product)));
});

router.patch("/admin/products/status", requireStoreAuth, requireStorePermission("products:update"), async (req, res): Promise<void> => {
  const body = BulkUpdateProductStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  const updatedCount = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(inArray(productsTable.id, body.data.productIds));
    if (existing.length !== body.data.productIds.length) return null;
    const updated = await tx
      .update(productsTable)
      .set({ status: body.data.status, active: body.data.status === "active", updatedAt: new Date() })
      .where(inArray(productsTable.id, body.data.productIds))
      .returning({ id: productsTable.id });
    await tx.insert(auditEventsTable).values({
      actorId: profile.userId,
      actorName: profile.fullName,
      action: "product.bulk_status_updated",
      entityType: "product",
      entityId: "bulk",
      details: { productIds: body.data.productIds, status: body.data.status },
    });
    return updated.length;
  });
  if (updatedCount === null) {
    res.status(400).json({ error: "One or more selected products do not exist." });
    return;
  }
  void publishProductsUpdated(body.data.productIds);
  res.json(BulkUpdateProductStatusResponse.parse({ updatedCount }));
});

router.patch("/admin/products/:productId", requireStoreAuth, requireStorePermission("products:update"), async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  const body = UpdateProductBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [existing] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.productId));
  if (!existing) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  const validatedPromotionStartsAt =
    body.data.promotionStartsAt !== undefined ? body.data.promotionStartsAt : existing.promotionStartsAt;
  const validatedPromotionEndsAt =
    body.data.promotionEndsAt !== undefined ? body.data.promotionEndsAt : existing.promotionEndsAt;
  if (!isValidPromotionWindow(validatedPromotionStartsAt, validatedPromotionEndsAt)) {
    res.status(400).json({ error: "O fim da promoção precisa ser posterior ao início." });
    return;
  }
  if (body.data.categoryId) {
    const [category] = await db
      .select({ id: categoriesTable.id })
      .from(categoriesTable)
      .where(and(eq(categoriesTable.id, body.data.categoryId), eq(categoriesTable.active, true)));
    if (!category) {
      res.status(400).json({ error: "A categoria selecionada não está disponível." });
      return;
    }
  }
  if (body.data.lineId) {
    const [line] = await db
      .select({ id: productLinesTable.id })
      .from(productLinesTable)
      .where(and(eq(productLinesTable.id, body.data.lineId), eq(productLinesTable.active, true)));
    if (!line) {
      res.status(400).json({ error: "A linha selecionada não está disponível." });
      return;
    }
  }
  const existingImages = body.data.images === undefined
    ? []
    : await db.select({ url: productImagesTable.url, isHover: productImagesTable.isHover })
      .from(productImagesTable)
      .where(eq(productImagesTable.productId, params.data.productId));
  const images = normalizeProductImages(body.data.images, body.data.imageUrl, body.data.name ?? existing.name, true, existingImages);
  if (images === null) {
    res.status(400).json({ error: "A galeria aceita até cinco fotos, com ordens únicas e no máximo uma capa e uma foto de hover." });
    return;
  }
  const {
    images: _images,
    promotionalPrice,
    promotionStartsAt,
    promotionEndsAt,
    active,
    status,
    ...productFields
  } = body.data;
  const updates: Partial<typeof productsTable.$inferInsert> = {
    ...productFields,
    ...(promotionalPrice !== undefined
      ? { promotionalPriceCents: promotionalPrice === null ? null : reaisToCents(promotionalPrice) }
      : {}),
    ...(promotionStartsAt !== undefined ? { promotionStartsAt } : {}),
    ...(promotionEndsAt !== undefined ? { promotionEndsAt } : {}),
    ...(status !== undefined
      ? { status, active: status === "active" }
      : active !== undefined
        ? { active, status: active ? "active" : "inactive" }
        : {}),
    ...(images !== undefined ? { imageUrl: getPrimaryImageUrl(images) } : {}),
  };
  const [product] = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, params.data.productId))
      .for("update");
    const beforeVariants = before
      ? await tx.select().from(productVariantsTable).where(eq(productVariantsTable.productId, before.id))
      : [];
    const result = await tx
      .update(productsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(productsTable.id, params.data.productId))
      .returning();
    const updatedProduct = result[0];
    if (
      before &&
      updatedProduct &&
      before.active &&
      before.status === "active" &&
      updatedProduct.active &&
      updatedProduct.status === "active"
    ) {
      const pricingNow = new Date();
      const priceDrop = beforeVariants
        .filter((variant) => variant.active)
        .map((variant) => ({
          name: variant.name,
          previous: effectiveVariantPriceCents(before, variant.priceCents, pricingNow),
          current: effectiveVariantPriceCents(updatedProduct, variant.priceCents, pricingNow),
        }))
        .filter((variant) => variant.current < variant.previous)
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
    if (images !== undefined) {
      await tx.delete(productImagesTable).where(eq(productImagesTable.productId, params.data.productId));
      if (images.length) {
        await tx.insert(productImagesTable).values(
          images.map((image) => ({
            productId: params.data.productId,
            url: image.url,
            alt: image.alt,
            sortOrder: image.sortOrder,
            isPrimary: image.isPrimary,
            isHover: image.isHover,
          })),
        );
      }
    }
    await tx.insert(auditEventsTable).values({
      actorId: profile.userId,
      actorName: profile.fullName,
      action: "product.updated",
      entityType: "product",
      entityId: params.data.productId,
      details: { changedFields: Object.keys(body.data) },
    });
    return result;
  });
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  const aggregate = await getProductById(product.id, true);
  if (!aggregate) throw new Error("Updated product could not be loaded.");
  publishProductUpdated(product.id);
  res.json(UpdateProductResponse.parse(serializeProduct(aggregate)));
});

router.delete("/admin/products/:productId", requireStoreAuth, requireStorePermission("products:archive"), async (req, res): Promise<void> => {
  const params = ArchiveProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [product] = await db
    .update(productsTable)
    .set({ active: false, status: "inactive", updatedAt: new Date() })
    .where(eq(productsTable.id, params.data.productId))
    .returning({ id: productsTable.id, name: productsTable.name });
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  await db.insert(auditEventsTable).values({
    actorId: profile.userId,
    actorName: profile.fullName,
    action: "product.archived",
    entityType: "product",
    entityId: product.id,
    details: { name: product.name },
  });
  publishProductUpdated(product.id);
  res.status(204).send(ArchiveProductResponse.parse(undefined));
});

router.post("/admin/products/:productId/variants", requireStoreAuth, requireStorePermission("products:create"), async (req, res): Promise<void> => {
  const params = CreateProductVariantParams.safeParse(req.params);
  const body = CreateProductVariantBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.id, params.data.productId), eq(productsTable.active, true)));
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  const [variant] = await db
    .insert(productVariantsTable)
    .values({
      productId: product.id,
      name: body.data.name,
      sku: body.data.sku.trim(),
      priceCents: reaisToCents(body.data.price),
      stock: body.data.stock,
      minimumStock: body.data.minimumStock ?? body.data.lowStockThreshold,
      barcode: body.data.barcode?.trim() || null,
      size: body.data.size?.trim() || null,
      color: body.data.color?.trim() || null,
      attributes: body.data.attributes ?? {},
      costPriceCents: body.data.costPrice == null ? null : reaisToCents(body.data.costPrice),
      weightGrams: body.data.weightGrams ?? null,
      dimensionsCm: body.data.dimensionsCm ?? null,
      active: body.data.active ?? true,
    })
    .returning();
  await db.insert(auditEventsTable).values({
    actorId: profile.userId,
    actorName: profile.fullName,
    action: "variant.created",
    entityType: "product_variant",
    entityId: variant.id,
    details: { productId: product.id, sku: variant.sku },
  });
  publishProductUpdated(product.id);
  void publishStockChanged([variant.id]);
  res.status(201).json(CreateProductVariantResponse.parse(serializeVariant(variant)));
});

router.patch("/admin/variants/:variantId", requireStoreAuth, requireStorePermission("products:update"), async (req, res): Promise<void> => {
  const params = UpdateProductVariantParams.safeParse(req.params);
  const body = UpdateProductVariantBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [variant] = await db
    .transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(productVariantsTable)
        .where(eq(productVariantsTable.id, params.data.variantId))
        .for("update");
      const {
        price,
        lowStockThreshold,
        minimumStock,
        costPrice,
        ...fields
      } = body.data;
      const updates: Partial<typeof productVariantsTable.$inferInsert> = {
        ...fields,
        ...(price !== undefined ? { priceCents: reaisToCents(price) } : {}),
        ...(lowStockThreshold !== undefined || minimumStock !== undefined
          ? { minimumStock: minimumStock ?? lowStockThreshold }
          : {}),
        ...(costPrice !== undefined
          ? { costPriceCents: costPrice === null ? null : reaisToCents(costPrice) }
          : {}),
        updatedAt: new Date(),
      };
      const result = await tx
        .update(productVariantsTable)
        .set(updates)
        .where(eq(productVariantsTable.id, params.data.variantId))
        .returning();
      const updatedVariant = result[0];
      if (before && updatedVariant && price !== undefined && before.active && updatedVariant.active) {
        const [product] = await tx
          .select()
          .from(productsTable)
          .where(eq(productsTable.id, updatedVariant.productId));
        if (product?.active && product.status === "active") {
          const pricingNow = new Date();
          const previousPrice = effectiveVariantPriceCents(product, before.priceCents, pricingNow);
          const currentPrice = effectiveVariantPriceCents(product, updatedVariant.priceCents, pricingNow);
          const subscribers = currentPrice < previousPrice
            ? await tx
                .select({ userId: profilesTable.userId, email: profilesTable.email })
                .from(profilesTable)
                .where(eq(profilesTable.communicationOptIn, true))
            : [];
          const notifications = buildPriceDropEmailRows(
            subscribers,
            product.name,
            previousPrice,
            currentPrice,
            updatedVariant.name,
          );
          if (notifications.length) await tx.insert(emailOutboxTable).values(notifications);
        }
      }
      return result;
    });
  if (!variant) {
    res.status(404).json({ error: "Variant not found." });
    return;
  }
  await db.insert(auditEventsTable).values({
    actorId: profile.userId,
    actorName: profile.fullName,
    action: "variant.updated",
    entityType: "product_variant",
    entityId: variant.id,
    details: { changedFields: Object.keys(body.data) },
  });
  publishProductUpdated(variant.productId);
  res.json(UpdateProductVariantResponse.parse(serializeVariant(variant)));
});

router.patch("/admin/variants/:variantId/stock", requireStoreAuth, requireStorePermission("inventory:adjust"), async (req, res): Promise<void> => {
  const params = AdjustStockParams.safeParse(req.params);
  const body = AdjustStockBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const profile = getStoreProfile(res);
  const variant = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(productVariantsTable)
      .where(eq(productVariantsTable.id, params.data.variantId))
      .for("update");
    if (!current) return undefined;
    const [updated] = await tx
      .update(productVariantsTable)
      .set({
        stock: body.data.stock + current.reservedStock,
        updatedAt: new Date(),
      })
      .where(eq(productVariantsTable.id, current.id))
      .returning();
    await tx.insert(stockMovementsTable).values({
      variantId: current.id,
      actorId: profile.userId,
      delta: body.data.stock - (current.stock - current.reservedStock),
      movementType: "manual_adjustment",
      quantityBefore: current.stock,
      quantityAfter: body.data.stock + current.reservedStock,
      reason: body.data.reason,
    });
    await tx.insert(auditEventsTable).values({
      actorId: profile.userId,
      actorName: profile.fullName,
      action: "stock.adjusted",
      entityType: "product_variant",
      entityId: current.id,
      details: { previous: current.stock, next: body.data.stock, reason: body.data.reason },
    });
    return updated;
  });
  if (!variant) {
    res.status(404).json({ error: "Variant not found." });
    return;
  }
  void publishStockChanged([variant.id]);
  res.json(AdjustStockResponse.parse(serializeVariant(variant)));
});

router.post("/admin/categories", requireStoreAuth, requireStorePermission("categories:manage"), async (req, res): Promise<void> => {
  const body = CreateCategoryBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [category] = await db
    .insert(categoriesTable)
    .values({ name: body.data.name, slug: createSlug(body.data.name), description: body.data.description ?? null, iconName: body.data.iconName ?? "shopping-bag" })
    .returning({ id: categoriesTable.id, name: categoriesTable.name, slug: categoriesTable.slug, description: categoriesTable.description, iconName: categoriesTable.iconName });
  await db.insert(auditEventsTable).values({
    actorId: profile.userId,
    actorName: profile.fullName,
    action: "category.created",
    entityType: "category",
    entityId: category.id,
    details: { name: category.name },
  });
  res.status(201).json(CreateCategoryResponse.parse(category));
});

router.patch("/admin/categories/:categoryId", requireStoreAuth, requireStorePermission("categories:manage"), async (req, res): Promise<void> => {
  const params = UpdateCategoryParams.safeParse(req.params);
  const body = UpdateCategoryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const profile = getStoreProfile(res);
  const category = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(categoriesTable)
      .set({
        ...body.data,
        ...(body.data.name ? { slug: createSlug(body.data.name) } : {}),
      })
      .where(eq(categoriesTable.id, params.data.categoryId))
      .returning();
    if (!updated) return undefined;
    await tx.insert(auditEventsTable).values({
      actorId: profile.userId,
      actorName: profile.fullName,
      action: "category.updated",
      entityType: "category",
      entityId: updated.id,
      details: { changedFields: Object.keys(body.data) },
    });
    return updated;
  });
  if (!category) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  res.json(UpdateCategoryResponse.parse(category));
});

router.delete("/admin/categories/:categoryId", requireStoreAuth, requireStorePermission("categories:manage"), async (req, res): Promise<void> => {
  const params = DeleteCategoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let reassignToCategoryId: string | undefined;
  if (req.body !== undefined && req.body !== null) {
    const body = DeleteCategoryBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    reassignToCategoryId = body.data.reassignToCategoryId;
  }
  const profile = getStoreProfile(res);
  const result = await db.transaction(async (tx) => {
    const [category] = await tx
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.id, params.data.categoryId))
      .limit(1);
    if (!category) return { kind: "not-found" as const };

    const linked = await tx
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.categoryId, category.id))
      .limit(1);
    if (linked.length && !reassignToCategoryId) return { kind: "reassignment-required" as const };
    if (reassignToCategoryId === category.id) return { kind: "invalid-target" as const };
    if (reassignToCategoryId) {
      const [target] = await tx
        .select({ id: categoriesTable.id })
        .from(categoriesTable)
        .where(and(eq(categoriesTable.id, reassignToCategoryId), eq(categoriesTable.active, true)))
        .limit(1);
      if (!target) return { kind: "invalid-target" as const };
      await tx
        .update(productsTable)
        .set({ categoryId: target.id, updatedAt: new Date() })
        .where(eq(productsTable.categoryId, category.id));
    }

    await tx
      .update(categoriesTable)
      .set({ active: false })
      .where(eq(categoriesTable.id, category.id));
    await tx.insert(auditEventsTable).values({
      actorId: profile.userId,
      actorName: profile.fullName,
      action: "category.archived",
      entityType: "category",
      entityId: category.id,
      details: { name: category.name, reassignToCategoryId: reassignToCategoryId ?? null },
    });
    return { kind: "archived" as const };
  });
  if (result.kind === "not-found") {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  if (result.kind === "reassignment-required") {
    res.status(409).json({ error: "Reassign the linked products before archiving this category." });
    return;
  }
  if (result.kind === "invalid-target") {
    res.status(400).json({ error: "Choose a different active category for reassignment." });
    return;
  }
  res.status(204).send(DeleteCategoryResponse.parse(undefined));
});

router.get("/admin/orders", requireStoreAuth, requireStorePermission("orders:read", "payments:read"), async (req, res): Promise<void> => {
  const query = ListAdminOrdersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  if (query.data.dateFrom && query.data.dateTo && query.data.dateFrom > query.data.dateTo) {
    res.status(400).json({ error: "A data inicial precisa ser anterior ou igual à data final." });
    return;
  }
  const invalidDate = [query.data.dateFrom, query.data.dateTo].some((value) => {
    if (!value) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value;
  });
  if (invalidDate) {
    res.status(400).json({ error: "Use datas válidas no formato AAAA-MM-DD." });
    return;
  }

  const orders = await getOrders(undefined, query.data.status);
  if (!orders.length) {
    res.json(ListAdminOrdersResponse.parse([]));
    return;
  }
  const userIds = [...new Set(orders.map((order) => order.userId).filter((userId): userId is string => Boolean(userId)))];
  const orderIds = orders.map((order) => order.id);
  const [profiles, payments] = await Promise.all([
    userIds.length ? db.select().from(profilesTable).where(inArray(profilesTable.userId, userIds)) : [],
    db.select().from(paymentsTable).where(inArray(paymentsTable.orderId, orderIds)),
  ]);
  const profilesByUserId = new Map(profiles.map((profile) => [profile.userId, profile]));
  const paymentsByOrderId = new Map(payments.map((payment) => [payment.orderId, payment]));
  const search = query.data.search?.trim().toLocaleLowerCase("pt-BR");
  const start = query.data.dateFrom
    ? new Date(`${query.data.dateFrom}T00:00:00.000-03:00`)
    : undefined;
  const endExclusive = query.data.dateTo
    ? new Date(`${query.data.dateTo}T00:00:00.000-03:00`)
    : undefined;
  if (endExclusive) endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const filteredOrders = orders.filter((order) => {
    if (query.data.paymentStatus && order.paymentStatus !== query.data.paymentStatus) return false;
    if (start && order.createdAt < start) return false;
    if (endExclusive && order.createdAt >= endExclusive) return false;
    if (!search) return true;
    const profile = order.userId ? profilesByUserId.get(order.userId) : undefined;
    const searchable = [
      order.orderNumber,
      order.customerName,
      order.customerEmail,
      order.customerPhone,
      profile?.fullName,
      profile?.email,
      profile?.phone,
      ...order.lines.flatMap((line) => [line.productName, line.variantName, line.sku]),
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLocaleLowerCase("pt-BR");
    return searchable.includes(search);
  });
  if (!filteredOrders.length) {
    res.json(ListAdminOrdersResponse.parse([]));
    return;
  }

  const filteredIds = filteredOrders.map((order) => order.id);
  const history = await db
    .select()
    .from(auditEventsTable)
    .where(
      and(
        eq(auditEventsTable.entityType, "order"),
        eq(auditEventsTable.action, "order.status_updated"),
        inArray(auditEventsTable.entityId, filteredIds),
      ),
    )
    .orderBy(asc(auditEventsTable.createdAt));
  const historyByOrder = new Map<string, typeof history>();
  for (const event of history) {
    const eventDetails = event.details as Record<string, unknown>;
    if (
      eventDetails.fromStatus === eventDetails.toStatus &&
      eventDetails.fromPaymentStatus === eventDetails.toPaymentStatus
    ) {
      continue;
    }
    const events = historyByOrder.get(event.entityId) ?? [];
    events.push(event);
    historyByOrder.set(event.entityId, events);
  }

  const result = filteredOrders.map((order) => {
    const profile = order.userId ? profilesByUserId.get(order.userId) : undefined;
    const details = (event: (typeof history)[number]) => event.details as Record<string, unknown>;
    return {
      ...serializeOrder(order),
      customerName: order.customerName ?? profile?.fullName ?? "Cliente visitante",
      customerEmail: order.customerEmail ?? profile?.email ?? "indisponivel@anonimizado.invalid",
      paymentMethod: paymentsByOrderId.get(order.id)?.method ?? "Não informado",
      statusHistory: (historyByOrder.get(order.id) ?? []).map((event) => {
        const change = details(event);
        return {
          id: event.id,
          fromStatus: typeof change.fromStatus === "string" ? change.fromStatus : null,
          toStatus: typeof change.toStatus === "string" ? change.toStatus : order.status,
          fromPaymentStatus: typeof change.fromPaymentStatus === "string" ? change.fromPaymentStatus : null,
          toPaymentStatus: typeof change.toPaymentStatus === "string" ? change.toPaymentStatus : null,
          actorName: event.actorName,
          createdAt: event.createdAt.toISOString(),
        };
      }),
    };
  });
  res.json(ListAdminOrdersResponse.parse(result));
});

router.patch("/admin/orders/:orderId/status", requireStoreAuth, requireStorePermission("orders:update"), async (req, res): Promise<void> => {
  const params = UpdateOrderStatusParams.safeParse(req.params);
  const body = UpdateOrderStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const profile = getStoreProfile(res);
  const requestedPaymentPermission = body.data.paymentStatus === "refunded"
    ? "payments:refund"
    : body.data.paymentStatus !== undefined || body.data.status === "paid"
      ? "payments:confirm"
      : undefined;
  if (requestedPaymentPermission && !(await getStorePermissionKeys(profile.userId)).includes(requestedPaymentPermission)) {
    res.status(403).json({
      error: requestedPaymentPermission === "payments:refund"
        ? "Você não tem permissão para registrar reembolsos."
        : "Você não tem permissão para confirmar pagamentos.",
      code: "INSUFFICIENT_PERMISSION",
      requiredPermissions: [requestedPaymentPermission],
    });
    return;
  }
  const changedVariantIds: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, params.data.orderId)).for("update");
      if (!order) throw new AdminActionError(404, "Order not found.");
      let nextStatus = body.data.status ?? order.status;
      let nextPaymentStatus = body.data.paymentStatus ?? order.paymentStatus;
      if (body.data.status === "paid") nextPaymentStatus = "paid";
      if (body.data.paymentStatus === "paid" && order.status === "awaiting_payment") nextStatus = "paid";
      if (order.paymentStatus === "paid" && nextPaymentStatus !== "paid" && nextPaymentStatus !== "refunded") {
        throw new AdminActionError(400, "Um pagamento confirmado só pode ser alterado para reembolsado.");
      }
      if (order.paymentStatus === "refunded" && nextPaymentStatus !== "refunded") {
        throw new AdminActionError(400, "Um pagamento reembolsado não pode voltar a outro status.");
      }
      if (nextPaymentStatus === "failed") nextStatus = "cancelled";
      const pickupMoves = order.shippingMethod === "pickup" ? ["picked_up"] : [];
      const allowedTransitions: Record<string, string[]> = {
        awaiting_payment: ["paid", "cancelled"],
        paid: ["packing", "cancelled", ...pickupMoves],
        packing: ["shipped", "cancelled", ...pickupMoves],
        shipped: ["delivered", "returned"],
        delivered: ["returned"],
        picked_up: ["returned"],
        cancelled: [],
        returned: [],
      };
      if (nextStatus !== order.status && !allowedTransitions[order.status]?.includes(nextStatus)) {
        throw new AdminActionError(400, "Esta mudança de etapa não é permitida para o pedido.");
      }
      if (
        body.data.paymentStatus === "paid" &&
        order.paymentStatus !== "pending"
      ) {
        throw new AdminActionError(400, "Só é possível confirmar um pagamento que ainda está pendente.");
      }
      if (
        body.data.paymentStatus === "pending" &&
        order.paymentStatus !== "pending"
      ) {
        throw new AdminActionError(400, "Um pagamento confirmado ou encerrado não pode voltar a ficar pendente.");
      }
      if (
        body.data.paymentStatus === "failed" &&
        order.paymentStatus !== "pending"
      ) {
        throw new AdminActionError(400, "Só é possível registrar falha em um pagamento pendente.");
      }
      if (nextPaymentStatus === "refunded" && order.paymentStatus !== "paid") {
        throw new AdminActionError(400, "Só é possível registrar reembolso para um pagamento confirmado.");
      }
      if (nextStatus === "cancelled" && nextPaymentStatus === "paid") {
        throw new AdminActionError(400, "Um pedido cancelado não pode permanecer com pagamento confirmado.");
      }
      if (["packing", "shipped", "delivered", "picked_up"].includes(nextStatus) && nextPaymentStatus !== "paid") {
        throw new AdminActionError(400, "Confirme manualmente o pagamento antes de avançar a separação ou entrega.");
      }
      if (order.paymentStatus === "paid" && nextStatus === "cancelled" && nextPaymentStatus !== "refunded") {
        throw new AdminActionError(400, "Registre a devolução manual antes de cancelar um pedido já pago.");
      }
      if (order.paymentStatus === "paid" && nextStatus === "returned" && nextPaymentStatus !== "refunded") {
        throw new AdminActionError(400, "Registre a devolução manual antes de marcar o pedido como devolvido.");
      }
      if (nextPaymentStatus === "refunded" && nextStatus !== "cancelled" && nextStatus !== "returned") {
        throw new AdminActionError(400, "Uma devolução só pode ser registrada para um pedido cancelado ou devolvido.");
      }

      if (nextPaymentStatus === "paid" && order.paymentStatus !== "paid") {
        const reservations = await tx
          .select()
          .from(stockReservationsTable)
          .where(and(eq(stockReservationsTable.orderId, order.id), eq(stockReservationsTable.status, "reserved")))
          .for("update");
        for (const reservation of reservations) {
          const [current] = await tx
            .select()
            .from(productVariantsTable)
            .where(eq(productVariantsTable.id, reservation.variantId))
            .for("update");
          if (!current || current.stock < reservation.quantity || current.reservedStock < reservation.quantity) {
            throw new AdminActionError(409, "O estoque reservado deste pedido não pode ser confirmado.");
          }
          const [updatedVariant] = await tx
            .update(productVariantsTable)
            .set({
              stock: sql`${productVariantsTable.stock} - ${reservation.quantity}`,
              reservedStock: sql`${productVariantsTable.reservedStock} - ${reservation.quantity}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(productVariantsTable.id, reservation.variantId),
                gte(productVariantsTable.stock, reservation.quantity),
                gte(productVariantsTable.reservedStock, reservation.quantity),
              ),
            )
            .returning({ stock: productVariantsTable.stock });
          if (!updatedVariant) throw new AdminActionError(409, "O estoque reservado deste pedido não pode ser confirmado.");
          await tx
            .update(stockReservationsTable)
            .set({ status: "committed", updatedAt: new Date() })
            .where(eq(stockReservationsTable.id, reservation.id));
          await tx.insert(stockMovementsTable).values({
            variantId: reservation.variantId,
            actorId: profile.userId,
            orderId: order.id,
            delta: -reservation.quantity,
            reservedDelta: -reservation.quantity,
            movementType: "sale",
            quantityBefore: current.stock,
            quantityAfter: updatedVariant.stock,
            reason: `Venda confirmada do pedido ${order.orderNumber}`,
          });
          changedVariantIds.push(reservation.variantId);
        }
      }

      if (
        (nextStatus === "cancelled" || nextStatus === "returned") &&
        order.status !== nextStatus
      ) {
        const reservations = await tx
          .select()
          .from(stockReservationsTable)
          .where(
            and(
              eq(stockReservationsTable.orderId, order.id),
              inArray(stockReservationsTable.status, ["reserved", "committed"]),
            ),
          )
          .for("update");
        for (const reservation of reservations) {
          const [current] = await tx
            .select()
            .from(productVariantsTable)
            .where(eq(productVariantsTable.id, reservation.variantId))
            .for("update");
          if (!current) throw new AdminActionError(409, "Não foi possível localizar uma variação deste pedido.");
          const isReserved = reservation.status === "reserved";
          if (isReserved && current.reservedStock < reservation.quantity) {
            throw new AdminActionError(409, "O estoque reservado deste pedido está inconsistente.");
          }
          const [updatedVariant] = await tx
            .update(productVariantsTable)
            .set({
              ...(isReserved
                ? { reservedStock: sql`${productVariantsTable.reservedStock} - ${reservation.quantity}` }
                : { stock: sql`${productVariantsTable.stock} + ${reservation.quantity}` }),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(productVariantsTable.id, reservation.variantId),
                ...(isReserved ? [gte(productVariantsTable.reservedStock, reservation.quantity)] : []),
              ),
            )
            .returning({ stock: productVariantsTable.stock });
          if (!updatedVariant) throw new AdminActionError(409, "Não foi possível liberar o estoque deste pedido.");
          await tx
            .update(stockReservationsTable)
            .set({ status: "released", updatedAt: new Date() })
            .where(eq(stockReservationsTable.id, reservation.id));
          await tx.insert(stockMovementsTable).values({
            variantId: reservation.variantId,
            actorId: profile.userId,
            orderId: order.id,
            delta: isReserved ? 0 : reservation.quantity,
            reservedDelta: isReserved ? -reservation.quantity : 0,
            movementType: isReserved ? "cancellation" : nextStatus === "returned" ? "return" : "cancellation",
            quantityBefore: current.stock,
            quantityAfter: updatedVariant.stock,
            reason: isReserved
              ? `Liberação de estoque por cancelamento ${order.orderNumber}`
              : nextStatus === "returned"
                ? `Reposição por devolução do pedido ${order.orderNumber}`
                : `Reposição por cancelamento do pedido ${order.orderNumber}`,
          });
          changedVariantIds.push(reservation.variantId);
        }
      }
      const [updated] = await tx
        .update(ordersTable)
        .set({
          status: nextStatus,
          paymentStatus: nextPaymentStatus,
          ...(body.data.trackingCode !== undefined ? { trackingCode: body.data.trackingCode } : {}),
          updatedAt: new Date(),
        })
        .where(eq(ordersTable.id, order.id))
        .returning();
      await tx
        .update(paymentsTable)
        .set({
          status: nextPaymentStatus,
          ...(nextPaymentStatus === "paid" ? { confirmedBy: profile.userId, confirmedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(paymentsTable.orderId, order.id));
      if (
        order.status !== updated.status ||
        order.paymentStatus !== updated.paymentStatus ||
        order.trackingCode !== updated.trackingCode
      ) {
        const [customer] = order.userId
          ? await tx
              .select({ email: profilesTable.email })
              .from(profilesTable)
              .where(eq(profilesTable.userId, order.userId))
          : [];
        const recipient = order.customerEmail ?? customer?.email;
        if (recipient) {
          await tx.insert(emailOutboxTable).values({
            userId: order.userId,
            recipient,
            eventType: "order_status_updated",
            subject: `Atualização do pedido ${order.orderNumber}`,
            payload: {
              orderNumber: order.orderNumber,
              fromStatus: order.status,
              toStatus: updated.status,
              fromPaymentStatus: order.paymentStatus,
              toPaymentStatus: updated.paymentStatus,
              trackingCode: updated.trackingCode,
            },
          });
        }
      }
      await tx.insert(auditEventsTable).values({
        actorId: profile.userId,
        actorName: profile.fullName,
        action: "order.status_updated",
        entityType: "order",
        entityId: order.id,
        details: {
          fromStatus: order.status,
          toStatus: updated.status,
          fromPaymentStatus: order.paymentStatus,
          toPaymentStatus: updated.paymentStatus,
          trackingCode: updated.trackingCode,
        },
      });
    });
  } catch (error) {
    if (error instanceof AdminActionError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
  const orders = await getOrders();
  const order = orders.find((item) => item.id === params.data.orderId);
  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  publishOrderUpdated(order.id, order.userId);
  void publishStockChanged(changedVariantIds);
  res.json(UpdateOrderStatusResponse.parse(serializeOrder(order)));
});

router.get("/admin/audit", requireStoreAuth, requireStorePermission("audit:read"), async (_req, res): Promise<void> => {
  const events = await db.select().from(auditEventsTable).orderBy(desc(auditEventsTable.createdAt)).limit(100);
  res.json(
    ListAuditEventsResponse.parse(
      events.map((event) => ({
        id: event.id,
        actorName: event.actorName,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        details: JSON.stringify(event.details),
        createdAt: event.createdAt.toISOString(),
      })),
    ),
  );
});

function serializeVariant(variant: typeof productVariantsTable.$inferSelect) {
  return {
    id: variant.id,
    name: variant.name,
    sku: variant.sku,
    price: centsToReais(variant.priceCents),
    stock: Math.max(0, variant.stock - variant.reservedStock),
    lowStockThreshold: variant.minimumStock,
    minimumStock: variant.minimumStock,
    reservedStock: variant.reservedStock,
    stockOnHand: variant.stock,
    barcode: variant.barcode,
    size: variant.size,
    color: variant.color,
    attributes: variant.attributes,
    costPrice: variant.costPriceCents === null ? null : centsToReais(variant.costPriceCents),
    weightGrams: variant.weightGrams,
    dimensionsCm: variant.dimensionsCm,
    active: variant.active,
  };
}

function createSlug(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
  return `${base || "radio-88"}-${randomToken()}`;
}

function randomToken(): string {
  return randomUUID().replaceAll("-", "").slice(0, 6);
}

class AdminActionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export default router;
