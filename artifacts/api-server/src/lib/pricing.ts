type Promotion = {
  promotionalPriceCents: number | null;
  promotionStartsAt: Date | null;
  promotionEndsAt: Date | null;
};

/**
 * A product promotion is a shared maximum sale price for every variant.
 * A variant that already costs less keeps its lower regular price.
 */
export function effectiveVariantPriceCents(
  product: Promotion,
  regularPriceCents: number,
  now = new Date(),
): number {
  const promotionalPriceCents = product.promotionalPriceCents;
  if (promotionalPriceCents === null) return regularPriceCents;
  if (product.promotionStartsAt && now < product.promotionStartsAt) return regularPriceCents;
  if (product.promotionEndsAt && now > product.promotionEndsAt) return regularPriceCents;
  return Math.min(regularPriceCents, promotionalPriceCents);
}

export function isValidPromotionWindow(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
): boolean {
  return !startsAt || !endsAt || startsAt.getTime() < endsAt.getTime();
}
