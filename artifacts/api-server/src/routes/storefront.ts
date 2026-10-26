import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import {
  AddCartLineBody,
  AddCartLineResponse,
  CreateCheckoutBody,
  CreateCheckoutResponse,
  GetCartResponse,
  GetProductParams,
  GetProductResponse,
  ListCategoriesResponse,
  ListProductsQueryParams,
  ListProductsResponse,
  QuoteShippingQueryParams,
  QuoteShippingResponse,
  RemoveCartLineParams,
  RemoveCartLineResponse,
  UpdateCartLineBody,
  UpdateCartLineParams,
  UpdateCartLineResponse,
} from "@workspace/api-zod";
import {
  addressesTable,
  auditEventsTable,
  cartLinesTable,
  cartsTable,
  categoriesTable,
  db,
  emailOutboxTable,
  fiscalCategoryRulesTable,
  fiscalProductProfilesTable,
  fiscalRecipientsTable,
  fiscalSettingsTable,
  orderLinesTable,
  ordersTable,
  paymentsTable,
  productVariantsTable,
  productsTable,
  profilesTable,
  stockReservationsTable,
  stockMovementsTable,
} from "@workspace/db";
import { getStoreProfile, requireStoreAuth } from "../middlewares/auth";
import { getOrder, serializeOrder } from "../lib/orders";
import { getProductById, getProducts, serializeProduct } from "../lib/serializers";
import { normalizePostalCode, pickupAddress, pickupOption, shippingOptionFromRate } from "../lib/shipping";
import { loadShippingCart, quoteResolvedShipping, shippingItemFromCatalog, shippingItemsFingerprint } from "../lib/superfrete";
import { loadShippingSettings } from "../lib/shipping-settings";
import { SuperfreteError, validatePostalCode } from "../lib/superfrete-client";
import { centsToReais, reaisToCents } from "../lib/currency";
import { effectiveVariantPriceCents } from "../lib/pricing";
import { publishOrderCreated, publishStockChanged } from "../lib/realtime";
import { matchesCatalogSearch, matchesCatalogVariantFilters } from "../lib/catalog-filters";
import { isValidCpfCnpj, normalizeTaxNumber } from "../lib/fiscal-validation";
import { getCheckoutFiscalState } from "../lib/fiscal-profile";

const router: IRouter = Router();

router.get("/categories", async (_req, res): Promise<void> => {
  const categories = await db
    .select({
      id: categoriesTable.id,
      name: categoriesTable.name,
      slug: categoriesTable.slug,
      description: categoriesTable.description,
      iconName: categoriesTable.iconName,
    })
    .from(categoriesTable)
    .where(eq(categoriesTable.active, true))
    .orderBy(asc(categoriesTable.name));
  res.json(ListCategoriesResponse.parse(categories));
});

router.get("/products", async (req, res): Promise<void> => {
  const parsed = ListProductsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = parsed.data;
  let products = await getProducts();
  const search = filters.search ?? "";
  if (search) {
    products = products.filter(product =>
      matchesCatalogSearch(search, [product.name, product.description, product.categoryName]),
    );
  }
  if (filters.categoryId) products = products.filter((product) => product.categoryId === filters.categoryId);
  if (filters.featured !== undefined) products = products.filter((product) => product.featured === filters.featured);
  if (filters.pieceType) products = products.filter(product => product.pieceType === filters.pieceType);
  const sizes = filters.sizes?.split("|").filter(Boolean) ?? [];
  products = products.filter(product => matchesCatalogVariantFilters(
    product.variants.map(variant => ({
      price: centsToReais(effectiveVariantPriceCents(product, variant.priceCents)),
      size: variant.size,
      available: variant.stock > variant.reservedStock,
    })),
    { minPrice: filters.minPrice, maxPrice: filters.maxPrice, sizes, inStock: filters.inStock },
  ));
  res.json(ListProductsResponse.parse(products.map(serializeProduct)));
});

router.get("/products/:productId", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const product = await getProductById(params.data.productId);
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  res.json(GetProductResponse.parse(serializeProduct(product)));
});

router.get("/shipping/quote", requireStoreAuth, async (req, res): Promise<void> => {
  const parsed = QuoteShippingQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const postalCode = normalizePostalCode(parsed.data.postalCode);
  if (postalCode.length !== 8) {
    res.status(400).json({ error: "Informe um CEP brasileiro com oito números." });
    return;
  }
  try {
    const settings = await loadShippingSettings();
    const items = await loadShippingCart(getStoreProfile(res).userId, settings);
    const quote = await quoteResolvedShipping(postalCode, items, settings);
    res.json(QuoteShippingResponse.parse([
      ...quote.rates.filter(rate => !rate.erro).map(shippingOptionFromRate), pickupOption,
    ]));
  } catch (error) {
    if (error instanceof SuperfreteError) {
      res.status(error.status).json({ error: error.message, code: error.code }); return;
    }
    throw error;
  }
});

router.get("/cart", requireStoreAuth, async (_req, res): Promise<void> => {
  const profile = getStoreProfile(res);
  res.json(GetCartResponse.parse(await loadCart(profile.userId)));
});

router.post("/cart/lines", requireStoreAuth, async (req, res): Promise<void> => {
  const parsed = AddCartLineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  await db.insert(cartsTable).values({ userId: profile.userId }).onConflictDoNothing();
  try {
    await db.transaction(async (tx) => {
      const [item] = await tx
        .select({ variant: productVariantsTable, productActive: productsTable.active })
        .from(productVariantsTable)
        .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
        .where(eq(productVariantsTable.id, parsed.data.variantId))
        .for("update");
      if (!item || !item.productActive || !item.variant.active) throw new CartInputError("Esta opção não está disponível.");
      const [line] = await tx
        .select()
        .from(cartLinesTable)
        .where(and(eq(cartLinesTable.userId, profile.userId), eq(cartLinesTable.variantId, item.variant.id)))
        .for("update");
      const quantity = (line?.quantity ?? 0) + parsed.data.quantity;
      if (quantity > 20 || quantity > item.variant.stock - item.variant.reservedStock) {
        throw new CartInputError("A quantidade escolhida excede o estoque disponível.");
      }
      if (line) {
        await tx.update(cartLinesTable).set({ quantity, updatedAt: new Date() }).where(eq(cartLinesTable.id, line.id));
      } else {
        await tx.insert(cartLinesTable).values({ userId: profile.userId, variantId: item.variant.id, quantity });
      }
    });
  } catch (error) {
    if (error instanceof CartInputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
  res.json(AddCartLineResponse.parse(await loadCart(profile.userId)));
});

router.patch("/cart/lines/:lineId", requireStoreAuth, async (req, res): Promise<void> => {
  const params = UpdateCartLineParams.safeParse(req.params);
  const body = UpdateCartLineBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [line] = await db
    .select({ line: cartLinesTable, variant: productVariantsTable })
    .from(cartLinesTable)
    .innerJoin(productVariantsTable, eq(cartLinesTable.variantId, productVariantsTable.id))
    .where(and(eq(cartLinesTable.id, params.data.lineId), eq(cartLinesTable.userId, profile.userId)));
  if (!line) {
    res.status(404).json({ error: "Cart line not found." });
    return;
  }
  if (body.data.quantity > line.variant.stock - line.variant.reservedStock || body.data.quantity > 20) {
    res.status(400).json({ error: "A quantidade escolhida excede o estoque disponível." });
    return;
  }
  await db
    .update(cartLinesTable)
    .set({ quantity: body.data.quantity, updatedAt: new Date() })
    .where(eq(cartLinesTable.id, line.line.id));
  res.json(UpdateCartLineResponse.parse(await loadCart(profile.userId)));
});

router.delete("/cart/lines/:lineId", requireStoreAuth, async (req, res): Promise<void> => {
  const params = RemoveCartLineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [deleted] = await db
    .delete(cartLinesTable)
    .where(and(eq(cartLinesTable.id, params.data.lineId), eq(cartLinesTable.userId, profile.userId)))
    .returning({ id: cartLinesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Cart line not found." });
    return;
  }
  res.json(RemoveCartLineResponse.parse(await loadCart(profile.userId)));
});

router.post("/checkout", requireStoreAuth, async (req, res): Promise<void> => {
  const parsed = CreateCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!parsed.data.acceptTerms) {
    res.status(400).json({ error: "É necessário aceitar os termos antes de criar o pedido." });
    return;
  }
  if (parsed.data.fiscalRecipient && !isValidCpfCnpj(parsed.data.fiscalRecipient.taxNumber)) {
    res.status(400).json({ error: "Informe um CPF ou CNPJ válido para a nota fiscal." });
    return;
  }

  const profile = getStoreProfile(res);
  const address = parsed.data.addressId
    ? (
        await db
          .select()
          .from(addressesTable)
          .where(and(eq(addressesTable.id, parsed.data.addressId), eq(addressesTable.userId, profile.userId)))
          .limit(1)
      )[0]
    : undefined;
  const shippingPostalCode = address?.postalCode ?? parsed.data.postalCode;
  const isPickup = parsed.data.shippingOptionId === pickupOption.id;
  if (!isPickup && !address) {
    res.status(400).json({ error: "Selecione um endereço salvo para a entrega." });
    return;
  }
  if (address && !isPickup &&
      normalizePostalCode(address.postalCode) !== normalizePostalCode(parsed.data.postalCode)) {
    res.status(400).json({ error: "O CEP cotado precisa corresponder ao endereço selecionado." });
    return;
  }
  try {
    const settings = await loadShippingSettings();
    const shippingItems = isPickup ? [] : await loadShippingCart(profile.userId, settings);
    const serviceId = parsed.data.shippingOptionId.replace(/^superfrete-/, "");
    // Bypass the quote cache at checkout. Never accept a fee supplied by the browser.
    const quote = isPickup ? undefined : await quoteResolvedShipping(validatePostalCode(shippingPostalCode), shippingItems, settings, true);
    const selectedService = quote?.services[serviceId];
    if (!isPickup && (!/^superfrete-\d+$/.test(parsed.data.shippingOptionId) || !selectedService)) {
      throw new CheckoutError(400, "A opção de entrega não está disponível. Calcule o frete novamente.");
    }
    const shippingOption = selectedService ? shippingOptionFromRate(selectedService.rate) : pickupOption;
    const shippingFeeCents = reaisToCents(shippingOption.fee);
    const orderId = await db.transaction(async (tx) => {
      const cartLines = await tx
        .select({ line: cartLinesTable, variant: productVariantsTable, product: productsTable })
        .from(cartLinesTable)
        .innerJoin(productVariantsTable, eq(cartLinesTable.variantId, productVariantsTable.id))
        .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
        .where(eq(cartLinesTable.userId, profile.userId))
        .orderBy(asc(productVariantsTable.id))
        .for("update");
      if (!cartLines.length) throw new CheckoutError(400, "Sua sacola está vazia.");
      const fiscalProfiles = await tx
        .select()
        .from(fiscalProductProfilesTable)
        .where(inArray(fiscalProductProfilesTable.productId, cartLines.map(({ product }) => product.id)));
      const fiscalProfileByProductId = new Map(fiscalProfiles.map((profile) => [profile.productId, profile]));
      const [fiscalSettings] = await tx.select().from(fiscalSettingsTable)
        .where(eq(fiscalSettingsTable.id, "default")).limit(1);
      const categoryIds = [...new Set(cartLines.map(({ product }) => product.categoryId).filter((id): id is string => !!id))];
      const categoryRules = categoryIds.length
        ? await tx.select().from(fiscalCategoryRulesTable).where(inArray(fiscalCategoryRulesTable.categoryId, categoryIds))
        : [];
      const fiscalRuleByCategoryId = new Map(categoryRules.map((rule) => [rule.categoryId, rule]));
      if (!isPickup && shippingItemsFingerprint(shippingItems) !== shippingItemsFingerprint(
        cartLines.map(({ product, variant, line }) => shippingItemFromCatalog(product, variant, line.quantity, settings)),
      )) {
        throw new CheckoutError(409, "A sacola ou os produtos mudaram durante a cotação. Calcule o frete novamente.");
      }

      const orderNumber = `88-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const paymentInstructions =
        "Pedido registrado para análise. Nenhum pagamento foi recebido. Aguarde as instruções oficiais de PIX da equipe Rádio 88 FM e não faça transferências antes de recebê-las.";
      const [order] = await tx
        .insert(ordersTable)
        .values({
          userId: profile.userId,
          customerName: profile.fullName,
          customerEmail: profile.email,
          customerPhone: profile.phone,
          orderNumber,
          status: "awaiting_payment",
          paymentStatus: "pending",
          shippingMethod: shippingOption.method,
          shippingLabel: shippingOption.label,
          shippingAddress: shippingOption.method === "pickup" ? pickupAddress : address ?? null,
          shippingServiceId: selectedService ? serviceId : null,
          shippingCarrier: selectedService?.rate.transportadora ?? null,
          shippingDays: shippingOption.estimatedDays,
          shippingQuote: selectedService ? {
            ...selectedService, items: shippingItems, originPostalCode: settings.originPostalCode,
            environment: process.env.SUPERFRETE_BASE_URL,
            quotedAt: new Date().toISOString(),
          } : null,
          subtotalCents: 0,
          shippingFeeCents,
          totalCents: 0,
          paymentInstructions,
          termsAcceptedAt: new Date(),
        })
        .returning();

      let subtotalCents = 0;
      const orderLineValues = [];
      const checkoutFiscalByProductId = new Map<string, ReturnType<typeof getCheckoutFiscalState>>();
      for (const cartLine of cartLines) {
        const [locked] = await tx
          .select({ variant: productVariantsTable, product: productsTable })
          .from(productVariantsTable)
          .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
          .where(eq(productVariantsTable.id, cartLine.variant.id))
          .for("update");
        const fiscalProfile = fiscalProfileByProductId.get(locked?.product.id ?? "");
        const categoryRule = locked?.product.categoryId
          ? fiscalRuleByCategoryId.get(locked.product.categoryId)
          : undefined;
        if (!locked) throw new CheckoutError(409, "Um produto não está mais disponível. Atualize a sacola.");
        const fiscalState = getCheckoutFiscalState({
          profile: fiscalProfile ?? null,
          ncmSuggestion: locked.product.ncmSuggestion,
          taxRegime: fiscalSettings?.taxRegime,
          mode: "manual",
          categoryCfop: categoryRule?.cfop,
          defaultCfop: fiscalSettings?.defaultCfop,
          categoryTaxPayload: categoryRule?.taxPayload,
        });
        if (!fiscalState.saleReady) {
          throw new CheckoutError(409, `O produto ${locked.product.name} precisa ter um NCM válido cadastrado antes da venda.`);
        }
        checkoutFiscalByProductId.set(locked.product.id, fiscalState);
        const availableStock = locked.variant.stock - locked.variant.reservedStock;
        if (!locked.product.active || !locked.variant.active || availableStock < cartLine.line.quantity) {
          throw new CheckoutError(409, `Estoque insuficiente para ${cartLine.product.name}.`);
        }
        const changed = await tx
          .update(productVariantsTable)
          .set({
            reservedStock: sql`${productVariantsTable.reservedStock} + ${cartLine.line.quantity}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(productVariantsTable.id, locked.variant.id),
              sql`${productVariantsTable.stock} - ${productVariantsTable.reservedStock} >= ${cartLine.line.quantity}`,
            ),
          )
          .returning({ stock: productVariantsTable.stock, reservedStock: productVariantsTable.reservedStock });
        if (!changed.length) throw new CheckoutError(409, `Estoque insuficiente para ${cartLine.product.name}.`);

        const priceCents = effectiveVariantPriceCents(locked.product, locked.variant.priceCents);
        const lineTotalCents = priceCents * cartLine.line.quantity;
        subtotalCents += lineTotalCents;
        orderLineValues.push({
          orderId: order.id,
          variantId: locked.variant.id,
          productName: locked.product.name,
          variantName: locked.variant.name,
          sku: locked.variant.sku,
          ...checkoutFiscalByProductId.get(locked.product.id)!.orderLineFiscalSnapshot,
          fiscalCategoryId: locked.product.categoryId ?? null,
          quantity: cartLine.line.quantity,
          originalUnitPriceCents: locked.variant.priceCents,
          unitPriceCents: priceCents,
          lineTotalCents,
        });
        await tx.insert(stockReservationsTable).values({
          orderId: order.id,
          variantId: locked.variant.id,
          quantity: cartLine.line.quantity,
          status: "reserved",
        });
        await tx.insert(stockMovementsTable).values({
          variantId: locked.variant.id,
          actorId: profile.userId,
          orderId: order.id,
          delta: 0,
          reservedDelta: cartLine.line.quantity,
          movementType: "reservation",
          quantityBefore: locked.variant.stock,
          quantityAfter: locked.variant.stock,
          reason: `Reserva para pedido ${orderNumber}`,
        });
      }

      const totalCents = subtotalCents + shippingFeeCents;
      const total = centsToReais(totalCents);
      await tx.insert(orderLinesTable).values(orderLineValues);
      if (parsed.data.fiscalRecipient) {
        await tx.insert(fiscalRecipientsTable).values({
          orderId: order.id,
          taxNumber: normalizeTaxNumber(parsed.data.fiscalRecipient.taxNumber),
          legalName: parsed.data.fiscalRecipient.legalName.trim(),
          email: profile.email.trim().toLowerCase(),
          address: {
            ...parsed.data.fiscalRecipient.address,
            postalCode: normalizePostalCode(parsed.data.fiscalRecipient.address.postalCode),
            state: parsed.data.fiscalRecipient.address.state.trim().toUpperCase(),
            complement: parsed.data.fiscalRecipient.address.complement?.trim() || null,
          },
        });
      }
      await tx
        .update(ordersTable)
        .set({ subtotalCents, totalCents, updatedAt: new Date() })
        .where(eq(ordersTable.id, order.id));
      await tx.insert(paymentsTable).values({
        orderId: order.id,
        method: "pix_manual",
        status: "pending",
        amountCents: totalCents,
        instruction: paymentInstructions,
      });
      await tx
        .update(profilesTable)
        .set({ termsAcceptedAt: new Date(), privacyAcceptedAt: new Date(), updatedAt: new Date() })
        .where(eq(profilesTable.userId, profile.userId));
      await tx.delete(cartLinesTable).where(eq(cartLinesTable.userId, profile.userId));
      await tx.insert(emailOutboxTable).values({
        userId: profile.userId,
        recipient: profile.email,
        eventType: "order_created",
        subject: `Pedido ${orderNumber} registrado`,
        payload: { orderNumber, total, paymentStatus: "pending" },
      });
      await tx.insert(auditEventsTable).values({
        actorId: profile.userId,
        actorName: profile.fullName,
        action: "order.created",
        entityType: "order",
        entityId: order.id,
        details: { orderNumber, total },
      });
      return order.id;
    });

    const order = await getOrder(orderId, profile.userId);
    if (!order) throw new Error("Newly created order could not be loaded.");
    publishOrderCreated(order.id, order.orderNumber);
    void publishStockChanged(order.lines.map((line) => line.variantId));
    res.status(201).json(CreateCheckoutResponse.parse(serializeOrder(order)));
  } catch (error) {
    if (error instanceof CheckoutError || error instanceof SuperfreteError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

async function loadCart(userId: string) {
  await db.insert(cartsTable).values({ userId }).onConflictDoNothing();
  const rows = await db
    .select({ line: cartLinesTable, variant: productVariantsTable, product: productsTable })
    .from(cartLinesTable)
    .innerJoin(productVariantsTable, eq(cartLinesTable.variantId, productVariantsTable.id))
    .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
    .where(eq(cartLinesTable.userId, userId));
  const lines = rows.map(({ line, variant, product }) => {
    const unitPriceCents = effectiveVariantPriceCents(product, variant.priceCents);
    return {
      id: line.id,
      variantId: variant.id,
      productName: product.name,
      variantName: variant.name,
      sku: variant.sku,
      imageUrl: product.imageUrl,
      unitPrice: centsToReais(unitPriceCents),
      quantity: line.quantity,
      stockAvailable: product.active && variant.active ? Math.max(0, variant.stock - variant.reservedStock) : 0,
      lineTotal: centsToReais(unitPriceCents * line.quantity),
    };
  });
  const subtotalCents = rows.reduce(
    (sum, { line, variant, product }) =>
      sum + effectiveVariantPriceCents(product, variant.priceCents) * line.quantity,
    0,
  );
  return { lines, subtotal: centsToReais(subtotalCents) };
}

class CartInputError extends Error {}
class CheckoutError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export default router;
