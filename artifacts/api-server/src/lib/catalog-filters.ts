export function matchesPriceRange(prices: number[], min?: number, max?: number): boolean {
  if (min === undefined && max === undefined) return true;
  return prices.some(price => (min === undefined || price >= min) && (max === undefined || price <= max));
}

export function matchesCatalogVariantFilters(
  variants: Array<{ price: number; size?: string | null; available?: boolean }>,
  filters: { minPrice?: number; maxPrice?: number; sizes?: string[]; inStock?: boolean },
): boolean {
  const requestedSizes = new Set((filters.sizes ?? []).map(size => normalizeCatalogSearch(size).toUpperCase()));
  if (filters.minPrice === undefined && filters.maxPrice === undefined && !requestedSizes.size && !filters.inStock) {
    return true;
  }

  return variants.some(variant => {
    const priceInRange =
      (filters.minPrice === undefined || variant.price >= filters.minPrice) &&
      (filters.maxPrice === undefined || variant.price <= filters.maxPrice);
    const sizeMatches =
      requestedSizes.size === 0 ||
      requestedSizes.has(normalizeCatalogSearch(variant.size ?? "").toUpperCase());
    const stockMatches = !filters.inStock || variant.available === true;
    return priceInRange && sizeMatches && stockMatches;
  });
}

export function normalizeCatalogSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");
}

export function matchesCatalogSearch(query: string, values: Array<string | null | undefined>): boolean {
  const normalizedQuery = normalizeCatalogSearch(query);
  if (!normalizedQuery) return true;
  return values.some(value => value != null && normalizeCatalogSearch(value).includes(normalizedQuery));
}
