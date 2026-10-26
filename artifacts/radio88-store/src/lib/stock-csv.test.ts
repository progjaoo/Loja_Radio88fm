import assert from "node:assert/strict";
import test from "node:test";
import { serializeStockCsv, validateStockCsv } from "./stock-csv.ts";
import type { StockItem } from "@workspace/api-client-react";

const sampleStock: StockItem = {
  productId: "product-1",
  productSlug: "camiseta-88",
  productName: 'Camiseta "88", edição',
  description: "Linha um\nlinha dois",
  imageUrl: null,
  categoryId: null,
  categoryName: null,
  categorySlug: null,
  lineId: null,
  lineName: null,
  lineSlug: null,
  baseSku: "CAM-88",
  internalCode: null,
  pieceType: null,
  brand: null,
  material: null,
  tags: ["rádio", "edição especial"],
  promotionalPrice: null,
  promotionStartsAt: null,
  promotionEndsAt: null,
  featured: false,
  productStatus: "active",
  productActive: true,
  variantId: "variant-1",
  variantName: "Preta",
  sku: "CAM-88-P",
  barcode: null,
  size: "M",
  color: "Preta",
  attributes: { estampa: "edição, limitada" },
  price: 129.9,
  costPrice: 55.5,
  stockOnHand: 7,
  reservedStock: 2,
  availableStock: 5,
  minimumStock: 2,
  weightGrams: 210,
  dimensionsCm: null,
  variantActive: true,
  updatedAt: "2026-10-08T12:00:00.000Z",
};

test("exports and reimports quoted fields, newlines, tags, JSON, and Brazilian price commas", () => {
  const csv = serializeStockCsv([sampleStock]).replace("129.9", "129,90").replace(',"', ',"');
  const result = validateStockCsv(csv);
  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].productName, sampleStock.productName);
  assert.equal(result.items[0].description, sampleStock.description);
  assert.equal(result.items[0].price, 129.9);
  assert.deepEqual(result.items[0].tags, sampleStock.tags);
  assert.deepEqual(result.items[0].attributes, sampleStock.attributes);
  assert.equal(result.items[0].availableStock, 5);
});

test("omits blank optional fields and rejects duplicate SKUs in one import", () => {
  const csv = [
    "baseSku,productName,variantName,sku,price,availableStock,brand",
    "BASE,Produto,Preta,SKU-1,10,2,Marca",
    "BASE,Produto,Azul,SKU-1,11,3,",
  ].join("\n");
  const result = validateStockCsv(csv);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].brand, "Marca");
  assert.match(result.errors[0], /SKU repetido/);
});

test("accepts semicolon-delimited CSV with decimal commas", () => {
  const csv = [
    "productSlug;productName;variantName;sku;price;availableStock",
    "camiseta;Camiseta;M;CAM-M;129,90;4",
  ].join("\r\n");
  const result = validateStockCsv(csv);
  assert.deepEqual(result.errors, []);
  assert.equal(result.items[0].price, 129.9);
});

test("reports unclosed quotes and rows above the 500-row limit", () => {
  assert.match(validateStockCsv('"productName;variantName').errors[0], /aspas sem fechamento/);
  const headers = "productSlug,productName,variantName,sku,price,availableStock";
  const row = "p,Produto,M,SKU,10,1";
  const result = validateStockCsv([headers, ...Array(501).fill(row)].join("\n"));
  assert.match(result.errors[0], /limite é 500/);
});
