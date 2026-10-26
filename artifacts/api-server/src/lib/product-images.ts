export type ProductImageDraft = {
  url: string;
  alt: string;
  sortOrder: number;
  isPrimary: boolean;
  isHover?: boolean;
};

export const MAX_PRODUCT_IMAGES = 5;

export function normalizeProductImages(
  images: ProductImageDraft[] | undefined,
  imageUrl: string | null | undefined,
  fallbackAlt: string,
  preserveWhenMissing = false,
  existingImages: ReadonlyArray<Pick<ProductImageDraft, "url" | "isHover">> = [],
): ProductImageDraft[] | undefined | null {
  if (images === undefined && imageUrl === undefined) return preserveWhenMissing ? undefined : [];
  const existingByUrl = new Map(existingImages.map((image) => [image.url, image.isHover === true]));
  const preserveLegacyHover = images?.every((image) => image.isHover === undefined) ?? false;
  const submitted =
    images ??
    (imageUrl
      ? [{ url: imageUrl, alt: fallbackAlt, sortOrder: 0, isPrimary: true }]
      : []);
  const normalized = submitted.map((image) => {
    const isHover = image.isHover ?? (preserveLegacyHover ? existingByUrl.get(image.url) ?? false : false);
    return isHover ? { ...image, isHover: true } : image;
  });
  if (
    normalized.length > MAX_PRODUCT_IMAGES ||
    normalized.some((image) => !Number.isInteger(image.sortOrder) || image.sortOrder < 0) ||
    new Set(normalized.map((image) => image.sortOrder)).size !== normalized.length ||
    normalized.filter((image) => image.isPrimary).length > 1 ||
    normalized.filter((image) => image.isHover).length > 1
  ) {
    return null;
  }
  const sorted = [...normalized].sort((left, right) => left.sortOrder - right.sortOrder);
  if (sorted.length && !sorted.some((image) => image.isPrimary)) sorted[0].isPrimary = true;
  return sorted;
}

export function getPrimaryImageUrl(images: ProductImageDraft[] | undefined): string | null {
  return images?.find((image) => image.isPrimary)?.url ?? images?.[0]?.url ?? null;
}
