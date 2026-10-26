import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import {
  categoriesTable,
  db,
  productImagesTable,
  productVariantsTable,
  productsTable,
  type Product,
  type ProductImage,
  type ProductVariant,
} from "@workspace/db";
import { centsToReais } from "./currency";

export type ProductAggregate = Product & {
  categoryName: string | null;
  images: ProductImage[];
  variants: ProductVariant[];
};

export async function getProducts(includeInactive = false): Promise<ProductAggregate[]> {
  const conditions = includeInactive ? undefined : eq(productsTable.active, true);
  const rows = await dbProductRows(conditions);
  return attachProductImages(groupProductRows(rows));
}

export async function getProductById(productId: string, includeInactive = false): Promise<ProductAggregate | undefined> {
  const rows = await dbProductRows(
    includeInactive
      ? eq(productsTable.id, productId)
      : and(eq(productsTable.id, productId), eq(productsTable.active, true)),
  );
  return (await attachProductImages(groupProductRows(rows)))[0];
}

export function serializeProduct(product: ProductAggregate) {
  const primaryImage = product.images.find((image) => image.isPrimary) ?? product.images[0];
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    imageUrl: primaryImage?.url ?? product.imageUrl,
    galleryLayout: product.galleryLayout,
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
      isHover: image.isHover,
    })),
    categoryId: product.categoryId,
    categoryName: product.categoryName,
    lineId: product.lineId,
    baseSku: product.baseSku,
    internalCode: product.internalCode,
    pieceType: product.pieceType,
    brand: product.brand,
    material: product.material,
    ncmSuggestion: product.ncmSuggestion,
    tags: product.tags,
    promotionalPrice: product.promotionalPriceCents === null ? null : centsToReais(product.promotionalPriceCents),
    promotionStartsAt: product.promotionStartsAt?.toISOString() ?? null,
    promotionEndsAt: product.promotionEndsAt?.toISOString() ?? null,
    featured: product.featured,
    active: product.active,
    status: product.status,
    createdAt: product.createdAt.toISOString(),
    variants: product.variants.map((variant) => ({
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
      active: variant.active,
      attributes: variant.attributes,
      costPrice: variant.costPriceCents === null ? null : centsToReais(variant.costPriceCents),
      weightGrams: variant.weightGrams,
      dimensionsCm: variant.dimensionsCm,
    })),
  };
}

function groupProductRows(
  rows: Array<{
    product: Product;
    categoryName: string | null;
    variant: ProductVariant | null;
  }>,
): ProductAggregate[] {
  const products = new Map<string, ProductAggregate>();
  for (const row of rows) {
    let product = products.get(row.product.id);
    if (!product) {
      product = { ...row.product, categoryName: row.categoryName, images: [], variants: [] };
      products.set(row.product.id, product);
    }
    if (row.variant) product.variants.push(row.variant);
  }
  return [...products.values()];
}

async function attachProductImages(products: ProductAggregate[]): Promise<ProductAggregate[]> {
  if (!products.length) return products;
  const images = await db
    .select()
    .from(productImagesTable)
    .where(inArray(productImagesTable.productId, products.map((product) => product.id)))
    .orderBy(asc(productImagesTable.sortOrder), asc(productImagesTable.createdAt));
  const imagesByProduct = new Map<string, ProductImage[]>();
  for (const image of images) {
    const productImages = imagesByProduct.get(image.productId) ?? [];
    productImages.push(image);
    imagesByProduct.set(image.productId, productImages);
  }
  return products.map((product) => ({ ...product, images: imagesByProduct.get(product.id) ?? [] }));
}

async function dbProductRows(where?: SQL) {
  const conditions = [
    ...(where ? [where] : []),
    eq(productVariantsTable.active, true),
  ];
  const query = db
    .select({
      product: productsTable,
      categoryName: categoriesTable.name,
      variant: productVariantsTable,
    })
    .from(productsTable)
    .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
    .leftJoin(
      productVariantsTable,
      and(eq(productVariantsTable.productId, productsTable.id), eq(productVariantsTable.active, true)),
    );
  return query.where(and(...conditions));
}

export function addressToText(address: Record<string, unknown> | null): string | null {
  if (!address) return null;
  const parts = [
    [address.street, address.number].filter(Boolean).join(", "),
    address.complement,
    address.neighborhood,
    [address.city, address.state].filter(Boolean).join(" - "),
    address.postalCode ? `CEP ${address.postalCode}` : null,
  ].filter((part): part is string => typeof part === "string" && part.length > 0);
  return parts.join(" · ");
}

export function serializeAddress(address: {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  isDefault: boolean;
}) {
  return { ...address };
}
