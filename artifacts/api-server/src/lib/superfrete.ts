import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, cartLinesTable, productsTable, productVariantsTable, type Product, type ProductVariant } from "@workspace/db";
import type { ShippingSettings } from "@workspace/api-zod";
import { effectiveVariantPriceCents } from "./pricing";
import { logger } from "./logger";
import { loadShippingSettings } from "./shipping-settings";
import { ShippingQuoteCache, SuperfreteClient, SuperfreteError, validatePostalCode, type ShippingItem, type QuoteResult } from "./superfrete-client";

const cache = new ShippingQuoteCache();
const inFlight = new Map<string, Promise<QuoteResult>>();
export function clearShippingQuoteCache(): void { cache.clear(); }

export function superfreteClient(): SuperfreteClient {
  return new SuperfreteClient({
    token: process.env.SUPERFRETE_TOKEN ?? "",
    baseUrl: process.env.SUPERFRETE_BASE_URL ?? "",
    contactEmail: process.env.SUPERFRETE_CONTACT_EMAIL ?? "",
  }, fetch, details => logger.warn(details, "SuperFrete request failed"));
}

export function shippingItemFromCatalog(product: Product, variant: ProductVariant, quantity: number, settings: ShippingSettings): ShippingItem {
  const positiveOrDefault = (value: number | undefined | null, fallback: number) => value && value > 0 ? value : fallback;
  return {
    variantId: variant.id, quantity, name: product.name,
    unitPriceCents: effectiveVariantPriceCents(product, variant.priceCents),
    weight: variant.weightGrams && variant.weightGrams > 0 ? variant.weightGrams / 1000 : settings.defaultWeightKg,
    height: positiveOrDefault(variant.dimensionsCm?.height, settings.defaultHeightCm),
    width: positiveOrDefault(variant.dimensionsCm?.width, settings.defaultWidthCm),
    length: positiveOrDefault(variant.dimensionsCm?.length, settings.defaultLengthCm),
  };
}

export function shippingItemsFingerprint(items: ShippingItem[]): string {
  return createHash("sha256").update(JSON.stringify([...items].sort((a, b) => a.variantId.localeCompare(b.variantId)))).digest("hex");
}

export async function loadShippingItems(itens: { variantId: string; quantity: number }[], settings: ShippingSettings): Promise<ShippingItem[]> {
  if (!itens.length || itens.length > 100 || new Set(itens.map(item => item.variantId)).size !== itens.length ||
      itens.some(item => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.variantId) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20)) {
    throw new SuperfreteError(400, "INVALID_CART", "Confira os produtos e quantidades da sacola.");
  }
  const rows = await db.select({ variant: productVariantsTable, product: productsTable })
    .from(productVariantsTable)
    .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
    .where(inArray(productVariantsTable.id, itens.map(item => item.variantId)));
  if (rows.length !== itens.length || rows.some(({ product, variant }) => !product.active || product.status !== "active" || !variant.active)) {
    throw new SuperfreteError(400, "INVALID_CART", "Um produto não está mais disponível. Atualize a sacola.");
  }
  const quantities = new Map(itens.map(item => [item.variantId, item.quantity]));
  return rows.map(({ product, variant }) => shippingItemFromCatalog(product, variant, quantities.get(variant.id)!, settings));
}

export async function loadShippingCart(userId: string, settings: ShippingSettings) {
  const rows = await db.select({ variantId: cartLinesTable.variantId, quantity: cartLinesTable.quantity })
    .from(cartLinesTable).where(eq(cartLinesTable.userId, userId));
  return loadShippingItems(rows, settings);
}

export async function cotarFrete(input: {
  cepDestino: string;
  itens: { variantId: string; quantity: number }[];
  fresh?: boolean;
}) {
  const settings = await loadShippingSettings();
  const items = await loadShippingItems(input.itens, settings);
  const result = await quoteResolvedShipping(input.cepDestino, items, settings, input.fresh);
  return { ...result, items, settings };
}

export async function quoteResolvedShipping(cepDestino: string, items: ShippingItem[], settings: ShippingSettings, fresh = false): Promise<QuoteResult> {
  const cep = validatePostalCode(cepDestino);
  const client = superfreteClient();
  const key = createHash("sha256").update(JSON.stringify({
    cep, fingerprint: shippingItemsFingerprint(items), settings, environment: process.env.SUPERFRETE_BASE_URL,
  })).digest("hex");
  if (!fresh) {
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = inFlight.get(key);
    if (pending) return pending;
  }
  const request = client.cotarFrete({ cepDestino: cep, itens: items, settings });
  if (!fresh) inFlight.set(key, request);
  try {
    const result = await request;
    cache.set(key, result);
    return result;
  } finally {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }
}
