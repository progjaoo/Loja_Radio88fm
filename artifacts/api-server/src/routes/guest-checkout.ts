import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  CreateGuestCheckoutBody,
  CreateGuestCheckoutResponse,
  QuoteGuestShippingBody,
  QuoteGuestShippingResponse,
} from "@workspace/api-zod";
import {
  auditEventsTable,
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
  stockMovementsTable,
  stockReservationsTable,
} from "@workspace/db";
import { centsToReais, reaisToCents } from "../lib/currency";
import { effectiveVariantPriceCents } from "../lib/pricing";
import { getOrder, serializeOrder } from "../lib/orders";
import {
  loadShippingItems,
  quoteResolvedShipping,
  shippingItemFromCatalog,
  shippingItemsFingerprint,
} from "../lib/superfrete";
import { loadShippingSettings } from "../lib/shipping-settings";
import { normalizePostalCode, pickupAddress, pickupOption, shippingOptionFromRate } from "../lib/shipping";
import { SuperfreteError, validatePostalCode } from "../lib/superfrete-client";
import { publishOrderCreated, publishStockChanged } from "../lib/realtime";
import { isValidCpfCnpj, normalizeTaxNumber } from "../lib/fiscal-validation";
import { getCheckoutFiscalState } from "../lib/fiscal-profile";

const router: IRouter = Router();
const quoteLimits = new Map<string, { expiresAt: number; count: number }>();
const MAX_QUOTES_PER_MINUTE = 20;

router.post("/shipping/guest-quote", async (req, res): Promise<void> => {
  const parsed = QuoteGuestShippingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Informe um CEP válido e os produtos da sacola." });
    return;
  }
  const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  for (const [address, limit] of quoteLimits) {
    if (limit.expiresAt <= now) quoteLimits.delete(address);
  }
  const limit = quoteLimits.get(key) ?? { expiresAt: now + 60_000, count: 0 };
  if (limit.count >= MAX_QUOTES_PER_MINUTE) {
    res.setHeader("Retry-After", Math.ceil((limit.expiresAt - now) / 1000));
    res.status(429).json({ error: "Muitas consultas de frete. Aguarde um minuto e tente novamente." });
    return;
  }
  limit.count += 1;
  quoteLimits.set(key, limit);

  try {
    const postalCode = validatePostalCode(parsed.data.postalCode);
    const settings = await loadShippingSettings();
    const items = await loadShippingItems(parsed.data.items, settings);
    const quote = await quoteResolvedShipping(postalCode, items, settings);
    res.json(QuoteGuestShippingResponse.parse([
      ...quote.rates.filter((rate) => !rate.erro).map(shippingOptionFromRate),
      pickupOption,
    ]));
  } catch (error) {
    if (error instanceof SuperfreteError) {
      req.log.warn({ code: error.code }, "Guest shipping quote unavailable");
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }
});

router.post("/guest-checkout", async (req, res): Promise<void> => {
  const parsed = CreateGuestCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  if (!input.acceptTerms) {
    res.status(400).json({ error: "É necessário aceitar os termos antes de criar o pedido." });
    return;
  }
  if (input.fiscalRecipient && !isValidCpfCnpj(input.fiscalRecipient.taxNumber)) {
    res.status(400).json({ error: "Informe um CPF ou CNPJ válido para a nota fiscal." });
    return;
  }
  if (new Set(input.items.map((item) => item.variantId)).size !== input.items.length) {
    res.status(400).json({ error: "Cada produto deve aparecer uma única vez na sacola." });
    return;
  }

  const isPickup = input.shippingOptionId === pickupOption.id;
  const address = input.shippingAddress;
  const postalCode = normalizePostalCode(input.postalCode);
  if (!isPickup && !address) {
    res.status(400).json({ error: "Informe o endereço completo para a entrega." });
    return;
  }
  if (address && normalizePostalCode(address.postalCode) !== postalCode) {
    res.status(400).json({ error: "O CEP cotado precisa corresponder ao endereço informado." });
    return;
  }

  try {
    const settings = await loadShippingSettings();
    const shippingItems = await loadShippingItems(input.items, settings);
    const serviceId = input.shippingOptionId.replace(/^superfrete-/, "");
    const quote = isPickup
      ? undefined
      : await quoteResolvedShipping(validatePostalCode(postalCode), shippingItems, settings, true);
    const selectedService = quote?.services[serviceId];
    if (!isPickup && (!/^superfrete-\d+$/.test(input.shippingOptionId) || !selectedService)) {
      throw new GuestCheckoutError(400, "A opção de entrega não está disponível. Calcule o frete novamente.");
    }
    const shippingOption = selectedService ? shippingOptionFromRate(selectedService.rate) : pickupOption;
    const shippingFeeCents = reaisToCents(shippingOption.fee);
    const normalizedEmail = input.email.trim().toLocaleLowerCase("pt-BR");
    const customerName = input.fullName.trim();
    const customerPhone = input.phone.trim();
    const shippingAddress = !isPickup && address
      ? {
          recipientName: address.recipientName.trim(),
          phone: address.phone.trim(),
          postalCode,
          street: address.street.trim(),
          number: address.number.trim(),
          complement: address.complement?.trim() || null,
          neighborhood: address.neighborhood.trim(),
          city: address.city.trim(),
          state: address.state,
        }
      : pickupAddress;

    const orderId = await db.transaction(async (tx) => {
      const variants = await tx
        .select({ variant: productVariantsTable, product: productsTable })
        .from(productVariantsTable)
        .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
        .where(inArray(productVariantsTable.id, input.items.map((item) => item.variantId)))
        .orderBy(asc(productVariantsTable.id))
        .for("update");
      if (variants.length !== input.items.length) {
        throw new GuestCheckoutError(400, "Um produto não está mais disponível. Atualize a sacola.");
      }
      const productsByVariant = new Map(variants.map((row) => [row.variant.id, row]));
      const fiscalProfiles = await tx
        .select()
        .from(fiscalProductProfilesTable)
        .where(inArray(fiscalProductProfilesTable.productId, variants.map(({ product }) => product.id)));
      const fiscalProfileByProductId = new Map(fiscalProfiles.map((profile) => [profile.productId, profile]));
      const [fiscalSettings] = await tx.select().from(fiscalSettingsTable)
        .where(eq(fiscalSettingsTable.id, "default")).limit(1);
      const categoryIds = [...new Set(variants.map(({ product }) => product.categoryId).filter((id): id is string => !!id))];
      const categoryRules = categoryIds.length
        ? await tx.select().from(fiscalCategoryRulesTable).where(inArray(fiscalCategoryRulesTable.categoryId, categoryIds))
        : [];
      const fiscalRuleByCategoryId = new Map(categoryRules.map((rule) => [rule.categoryId, rule]));
      const checkoutFiscalByProductId = new Map<string, ReturnType<typeof getCheckoutFiscalState>>();
      const currentShippingItems = input.items.map((line) => {
        const row = productsByVariant.get(line.variantId);
        if (!row || !row.product.active || row.product.status !== "active" || !row.variant.active) {
          throw new GuestCheckoutError(400, "Um produto não está mais disponível. Atualize a sacola.");
        }
        const profile = fiscalProfileByProductId.get(row.product.id);
        const categoryRule = row.product.categoryId
          ? fiscalRuleByCategoryId.get(row.product.categoryId)
          : undefined;
        const fiscalState = getCheckoutFiscalState({
          profile: profile ?? null,
          ncmSuggestion: row.product.ncmSuggestion,
          taxRegime: fiscalSettings?.taxRegime,
          mode: "manual",
          categoryCfop: categoryRule?.cfop,
          defaultCfop: fiscalSettings?.defaultCfop,
          categoryTaxPayload: categoryRule?.taxPayload,
        });
        if (!fiscalState.saleReady) {
          throw new GuestCheckoutError(409, `O produto ${row.product.name} precisa ter um NCM válido cadastrado antes da venda.`);
        }
        checkoutFiscalByProductId.set(row.product.id, fiscalState);
        const available = row.variant.stock - row.variant.reservedStock;
        if (available < line.quantity) {
          throw new GuestCheckoutError(409, `Estoque insuficiente para ${row.product.name}.`);
        }
        return shippingItemFromCatalog(row.product, row.variant, line.quantity, settings);
      });
      if (!isPickup && shippingItemsFingerprint(shippingItems) !== shippingItemsFingerprint(currentShippingItems)) {
        throw new GuestCheckoutError(409, "Os produtos mudaram durante a cotação. Calcule o frete novamente.");
      }

      const orderNumber = `88-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const paymentInstructions =
        "Pedido registrado para análise. Nenhum pagamento foi recebido. Aguarde as instruções oficiais de PIX da equipe Rádio 88 FM e não faça transferências antes de recebê-las.";
      const [order] = await tx
        .insert(ordersTable)
        .values({
          userId: null,
          customerName,
          customerEmail: normalizedEmail,
          customerPhone,
          orderNumber,
          status: "awaiting_payment",
          paymentStatus: "pending",
          shippingMethod: shippingOption.method,
          shippingLabel: shippingOption.label,
          shippingAddress,
          shippingServiceId: selectedService ? serviceId : null,
          shippingCarrier: selectedService?.rate.transportadora ?? null,
          shippingDays: shippingOption.estimatedDays,
          shippingQuote: selectedService ? {
            ...selectedService,
            items: shippingItems,
            originPostalCode: settings.originPostalCode,
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
      for (const line of input.items) {
        const row = productsByVariant.get(line.variantId)!;
        const available = row.variant.stock - row.variant.reservedStock;
        const changed = await tx
          .update(productVariantsTable)
          .set({
            reservedStock: sql`${productVariantsTable.reservedStock} + ${line.quantity}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(productVariantsTable.id, row.variant.id),
              sql`${productVariantsTable.stock} - ${productVariantsTable.reservedStock} >= ${line.quantity}`,
            ),
          )
          .returning({ stock: productVariantsTable.stock, reservedStock: productVariantsTable.reservedStock });
        if (!changed.length || available < line.quantity) {
          throw new GuestCheckoutError(409, `Estoque insuficiente para ${row.product.name}.`);
        }
        const priceCents = effectiveVariantPriceCents(row.product, row.variant.priceCents);
        const lineTotalCents = priceCents * line.quantity;
        subtotalCents += lineTotalCents;
        orderLineValues.push({
          orderId: order.id,
          variantId: row.variant.id,
          productName: row.product.name,
          variantName: row.variant.name,
          sku: row.variant.sku,
          ...checkoutFiscalByProductId.get(row.product.id)!.orderLineFiscalSnapshot,
          fiscalCategoryId: row.product.categoryId ?? null,
          quantity: line.quantity,
          originalUnitPriceCents: row.variant.priceCents,
          unitPriceCents: priceCents,
          lineTotalCents,
        });
        await tx.insert(stockReservationsTable).values({
          orderId: order.id,
          variantId: row.variant.id,
          quantity: line.quantity,
          status: "reserved",
        });
        await tx.insert(stockMovementsTable).values({
          variantId: row.variant.id,
          actorId: null,
          orderId: order.id,
          delta: 0,
          reservedDelta: line.quantity,
          movementType: "reservation",
          quantityBefore: row.variant.stock,
          quantityAfter: row.variant.stock,
          reason: `Reserva para pedido de visitante ${orderNumber}`,
        });
      }

      const totalCents = subtotalCents + shippingFeeCents;
      const total = centsToReais(totalCents);
      await tx.insert(orderLinesTable).values(orderLineValues);
      if (input.fiscalRecipient) {
        await tx.insert(fiscalRecipientsTable).values({
          orderId: order.id,
          taxNumber: normalizeTaxNumber(input.fiscalRecipient.taxNumber),
          legalName: input.fiscalRecipient.legalName.trim(),
          email: normalizedEmail,
          address: {
            ...input.fiscalRecipient.address,
            postalCode: normalizePostalCode(input.fiscalRecipient.address.postalCode),
            state: input.fiscalRecipient.address.state.trim().toUpperCase(),
            complement: input.fiscalRecipient.address.complement?.trim() || null,
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
      await tx.insert(emailOutboxTable).values({
        userId: null,
        recipient: normalizedEmail,
        eventType: "order_created",
        subject: `Pedido ${orderNumber} registrado`,
        payload: { orderNumber, total, paymentStatus: "pending" },
      });
      await tx.insert(auditEventsTable).values({
        actorId: null,
        actorName: customerName,
        action: "order.created",
        entityType: "order",
        entityId: order.id,
        details: { orderNumber, total, source: "guest_checkout" },
      });
      return order.id;
    });

    const order = await getOrder(orderId);
    if (!order) throw new Error("Newly created guest order could not be loaded.");
    publishOrderCreated(order.id, order.orderNumber);
    void publishStockChanged(order.lines.map((line) => line.variantId));
    res.status(201).json(CreateGuestCheckoutResponse.parse(serializeOrder(order)));
  } catch (error) {
    if (error instanceof GuestCheckoutError || error instanceof SuperfreteError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

class GuestCheckoutError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export default router;
