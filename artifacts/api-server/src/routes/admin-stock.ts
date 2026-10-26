import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAdminStockMovementBody,
  CreateAdminStockMovementResponse,
  ImportAdminStockCatalogBody,
  ImportAdminStockCatalogResponse,
  ListAdminStockMovementsQueryParams,
  ListAdminStockMovementsResponse,
  ListAdminStockResponse,
} from "@workspace/api-zod";
import {
  auditEventsTable,
  categoriesTable,
  db,
  ordersTable,
  productLinesTable,
  productVariantsTable,
  productsTable,
  profilesTable,
  stockMovementsTable,
} from "@workspace/db";
import { centsToReais } from "../lib/currency";
import { importStockCatalog, StockImportError } from "../lib/stock-import";
import { getStoreProfile, requireStoreAuth, requireStorePermission } from "../middlewares/auth";
import { publishStockChanged } from "../lib/realtime";

const router: IRouter = Router();

router.get("/admin/stock", requireStoreAuth, requireStorePermission("inventory:read"), async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      product: productsTable,
      category: categoriesTable,
      line: productLinesTable,
      variant: productVariantsTable,
    })
    .from(productVariantsTable)
    .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
    .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
    .leftJoin(productLinesTable, eq(productsTable.lineId, productLinesTable.id))
    .orderBy(asc(productsTable.name), asc(productVariantsTable.sku));
  const items = rows.map(({ product, category, line, variant }) => ({
    productId: product.id,
    productSlug: product.slug,
    productName: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
    categoryId: product.categoryId,
    categoryName: category?.name ?? null,
    categorySlug: category?.slug ?? null,
    lineId: product.lineId,
    lineName: line?.name ?? null,
    lineSlug: line?.slug ?? null,
    baseSku: product.baseSku,
    internalCode: product.internalCode,
    pieceType: product.pieceType,
    brand: product.brand,
    material: product.material,
    tags: product.tags,
    promotionalPrice: product.promotionalPriceCents == null ? null : centsToReais(product.promotionalPriceCents),
    promotionStartsAt: product.promotionStartsAt,
    promotionEndsAt: product.promotionEndsAt,
    featured: product.featured,
    productStatus: product.status,
    productActive: product.active,
    variantId: variant.id,
    variantName: variant.name,
    sku: variant.sku,
    barcode: variant.barcode,
    size: variant.size,
    color: variant.color,
    attributes: variant.attributes,
    price: centsToReais(variant.priceCents),
    costPrice: variant.costPriceCents == null ? null : centsToReais(variant.costPriceCents),
    stockOnHand: variant.stock,
    reservedStock: variant.reservedStock,
    availableStock: variant.stock - variant.reservedStock,
    minimumStock: variant.minimumStock,
    weightGrams: variant.weightGrams,
    dimensionsCm: variant.dimensionsCm,
    variantActive: variant.active,
    updatedAt: variant.updatedAt,
  }));
  res.json(ListAdminStockResponse.parse(items));
});

router.get(
  "/admin/stock/movements",
  requireStoreAuth,
  requireStorePermission("inventory:read"),
  async (req, res): Promise<void> => {
    const params = ListAdminStockMovementsQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const page = params.data.page ?? 1;
    const pageSize = params.data.pageSize ?? 25;
    const search = params.data.search?.trim();
    const from = params.data.from ? new Date(params.data.from) : undefined;
    const to = params.data.to ? new Date(params.data.to) : undefined;
    if (from && to && from > to) {
      res.status(400).json({ error: "A data inicial precisa ser anterior à data final." });
      return;
    }
    const filters = and(
      params.data.movementType ? eq(stockMovementsTable.movementType, params.data.movementType) : undefined,
      from ? gte(stockMovementsTable.createdAt, from) : undefined,
      to ? lte(stockMovementsTable.createdAt, to) : undefined,
      search
        ? or(
            ilike(productVariantsTable.sku, `%${search}%`),
            ilike(productsTable.name, `%${search}%`),
            ilike(stockMovementsTable.reason, `%${search}%`),
          )
        : undefined,
    );
    const [countRows, rows] = await Promise.all([
      db
        .select({ total: count() })
        .from(stockMovementsTable)
        .innerJoin(productVariantsTable, eq(stockMovementsTable.variantId, productVariantsTable.id))
        .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
        .where(filters),
      db
        .select({
          movement: stockMovementsTable,
          variantName: productVariantsTable.name,
          sku: productVariantsTable.sku,
          productName: productsTable.name,
          actorName: profilesTable.fullName,
          orderNumber: ordersTable.orderNumber,
        })
        .from(stockMovementsTable)
        .innerJoin(productVariantsTable, eq(stockMovementsTable.variantId, productVariantsTable.id))
        .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
        .leftJoin(profilesTable, eq(stockMovementsTable.actorId, profilesTable.userId))
        .leftJoin(ordersTable, eq(stockMovementsTable.orderId, ordersTable.id))
        .where(filters)
        .orderBy(desc(stockMovementsTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);
    const items = rows.map(({ movement, variantName, sku, productName, actorName, orderNumber }) => ({
      id: movement.id,
      variantId: movement.variantId,
      productName,
      variantName,
      sku,
      movementType: movement.movementType,
      delta: movement.delta,
      reservedDelta: movement.reservedDelta,
      quantityBefore: movement.quantityBefore,
      quantityAfter: movement.quantityAfter,
      reason: movement.reason,
      orderId: movement.orderId,
      orderNumber: orderNumber ?? null,
      actorId: movement.actorId,
      actorName: actorName ?? null,
      createdAt: movement.createdAt,
    }));
    res.json(
      ListAdminStockMovementsResponse.parse({
        items,
        total: Number(countRows[0]?.total ?? 0),
        page,
        pageSize,
      }),
    );
  },
);

router.post(
  "/admin/stock/movements/manual",
  requireStoreAuth,
  requireStorePermission("inventory:adjust"),
  async (req, res): Promise<void> => {
    const body = CreateAdminStockMovementBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const profile = getStoreProfile(res);
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(productVariantsTable)
        .where(eq(productVariantsTable.id, body.data.variantId))
        .for("update");
      if (!current) return { kind: "not-found" as const };
      const delta = body.data.movementType === "inbound" ? body.data.quantity : -body.data.quantity;
      if (body.data.movementType === "outbound" && current.stock - current.reservedStock < body.data.quantity) {
        return { kind: "insufficient" as const };
      }
      const [updated] = await tx
        .update(productVariantsTable)
        .set({ stock: current.stock + delta, updatedAt: new Date() })
        .where(eq(productVariantsTable.id, current.id))
        .returning();
      const [product] = await tx
        .select({ name: productsTable.name })
        .from(productsTable)
        .where(eq(productsTable.id, current.productId));
      const [movement] = await tx
        .insert(stockMovementsTable)
        .values({
          variantId: current.id,
          actorId: profile.userId,
          delta,
          movementType: body.data.movementType,
          quantityBefore: current.stock,
          quantityAfter: updated.stock,
          reason: body.data.reason.trim(),
        })
        .returning();
      await tx.insert(auditEventsTable).values({
        actorId: profile.userId,
        actorName: profile.fullName,
        action: `stock.${body.data.movementType}`,
        entityType: "product_variant",
        entityId: current.id,
        details: { sku: current.sku, quantity: body.data.quantity, reason: body.data.reason.trim() },
      });
      return {
        kind: "success" as const,
        response: {
          id: movement.id,
          variantId: movement.variantId,
          productName: product.name,
          variantName: current.name,
          sku: current.sku,
          movementType: movement.movementType,
          delta: movement.delta,
          reservedDelta: movement.reservedDelta,
          quantityBefore: movement.quantityBefore,
          quantityAfter: movement.quantityAfter,
          reason: movement.reason,
          orderId: null,
          orderNumber: null,
          actorId: profile.userId,
          actorName: profile.fullName,
          createdAt: movement.createdAt,
        },
      };
    });
    if (result.kind === "not-found") {
      res.status(404).json({ error: "Variação não encontrada." });
      return;
    }
    if (result.kind === "insufficient") {
      res.status(409).json({ error: "A quantidade disponível não é suficiente para essa saída." });
      return;
    }
    void publishStockChanged([result.response.variantId]);
    res.status(201).json(CreateAdminStockMovementResponse.parse(result.response));
  },
);

router.post(
  "/admin/stock/import",
  requireStoreAuth,
  requireStorePermission("inventory:import", "products:create", "products:update"),
  async (req, res): Promise<void> => {
    const body = ImportAdminStockCatalogBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const profile = getStoreProfile(res);
    try {
      const result = await importStockCatalog(body.data.items, {
        userId: profile.userId,
        fullName: profile.fullName,
      });
      const importedVariants = await db
        .select({ id: productVariantsTable.id })
        .from(productVariantsTable)
        .where(inArray(productVariantsTable.sku, body.data.items.map((item) => item.sku)));
      void publishStockChanged(importedVariants.map((variant) => variant.id));
      res.json(ImportAdminStockCatalogResponse.parse(result));
    } catch (error) {
      if (error instanceof StockImportError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  },
);

export default router;
