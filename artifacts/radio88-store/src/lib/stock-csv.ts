import type { StockCatalogImportRow, StockItem } from "@workspace/api-client-react";

const columns = [
  "productSlug", "productName", "description", "imageUrl", "categorySlug", "lineSlug",
  "baseSku", "internalCode", "pieceType", "brand", "material", "tags", "promotionalPrice",
  "promotionStartsAt", "promotionEndsAt", "featured", "status", "variantName", "sku",
  "barcode", "size", "color", "attributes", "price", "costPrice", "availableStock",
  "minimumStock", "weightGrams", "dimensionsCm", "variantActive",
] as const;

function csvEscape(value: unknown): string {
  return `"${(value == null ? "" : String(value)).replaceAll('"', '""')}"`;
}

export function serializeStockCsv(rows: StockItem[]): string {
  const lines = [columns.join(","), ...rows.map(item => {
    const record: Record<string, unknown> = {
      productSlug: item.productSlug,
      productName: item.productName,
      description: item.description,
      imageUrl: item.imageUrl,
      categorySlug: item.categorySlug,
      lineSlug: item.lineSlug,
      baseSku: item.baseSku,
      internalCode: item.internalCode,
      pieceType: item.pieceType,
      brand: item.brand,
      material: item.material,
      tags: item.tags.join("|"),
      promotionalPrice: item.promotionalPrice,
      promotionStartsAt: item.promotionStartsAt,
      promotionEndsAt: item.promotionEndsAt,
      featured: item.featured,
      status: item.productStatus,
      variantName: item.variantName,
      sku: item.sku,
      barcode: item.barcode,
      size: item.size,
      color: item.color,
      attributes: JSON.stringify(item.attributes ?? {}),
      price: item.price,
      costPrice: item.costPrice,
      availableStock: item.availableStock,
      minimumStock: item.minimumStock,
      weightGrams: item.weightGrams,
      dimensionsCm: item.dimensionsCm ? JSON.stringify(item.dimensionsCm) : "",
      variantActive: item.variantActive,
    };
    return columns.map(column => csvEscape(record[column])).join(",");
  })];
  return `\uFEFF${lines.join("\r\n")}`;
}

function delimiterForHeader(source: string): string {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted && char === '"' && source[index + 1] === '"') {
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && (char === "\n" || char === "\r")) {
      break;
    } else if (!quoted && char === ",") {
      commas++;
    } else if (!quoted && char === ";") {
      semicolons++;
    }
  }
  return semicolons > commas ? ";" : ",";
}

function parseCsv(source: string): string[][] {
  const delimiter = delimiterForHeader(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(cell);
      cell = "";
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("O CSV contém aspas sem fechamento.");
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function numberCell(value: string): number {
  const raw = value.trim().replace(/\s/g, "");
  if (!raw) return Number.NaN;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  return Number(normalized);
}

function booleanCell(value: string): boolean | null {
  const text = value.trim().toLocaleLowerCase("pt-BR");
  if (["true", "1", "sim", "yes"].includes(text)) return true;
  if (["false", "0", "não", "nao", "no"].includes(text)) return false;
  return null;
}

export function validateStockCsv(source: string): { items: StockCatalogImportRow[]; errors: string[] } {
  let rows: string[][];
  try {
    rows = parseCsv(source);
  } catch (error) {
    return { items: [], errors: [error instanceof Error ? error.message : "CSV inválido."] };
  }
  if (rows.length < 2) return { items: [], errors: ["O arquivo não contém linhas de dados."] };
  const headers = rows[0].map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim());
  const errors: string[] = [];
  if (new Set(headers).size !== headers.length) errors.push("O cabeçalho contém nomes de coluna repetidos.");
  if (rows.length - 1 > 500) errors.push(`O lote tem ${rows.length - 1} linhas; o limite é 500.`);
  const required = ["productName", "variantName", "sku", "price", "availableStock"];
  required.forEach(key => { if (!headers.includes(key)) errors.push(`Coluna obrigatória ausente: ${key}.`); });
  const items: StockCatalogImportRow[] = [];
  const seenSkus = new Set<string>();
  rows.slice(1, 501).forEach((values, index) => {
    const rowNumber = index + 2;
    const raw: Record<string, string> = {};
    headers.forEach((header, columnIndex) => { if (header) raw[header] = (values[columnIndex] ?? "").trim(); });
    const rowErrors: string[] = [];
    required.forEach(field => { if (!raw[field]) rowErrors.push(`${field} é obrigatório`); });
    if (!raw.productSlug && !raw.baseSku) rowErrors.push("informe productSlug ou baseSku");
    const skuKey = raw.sku?.toLocaleLowerCase("pt-BR");
    if (skuKey && seenSkus.has(skuKey)) rowErrors.push("SKU repetido no arquivo");
    if (skuKey) seenSkus.add(skuKey);

    const price = numberCell(raw.price ?? "");
    const availableStock = numberCell(raw.availableStock ?? "");
    if (!Number.isFinite(price) || price < 0) rowErrors.push("price inválido");
    if (!Number.isInteger(availableStock) || availableStock < 0) rowErrors.push("availableStock deve ser inteiro não negativo");

    const entry: Record<string, unknown> = {};
    const stringFields = [
      "productSlug", "productName", "description", "imageUrl", "categorySlug", "lineSlug", "baseSku",
      "internalCode", "pieceType", "brand", "material", "variantName", "sku", "barcode", "size", "color",
    ];
    stringFields.forEach(field => { if (raw[field]) entry[field] = raw[field]; });
    if (raw.tags) {
      const tags = raw.tags.split("|").map(tag => tag.trim()).filter(Boolean);
      if (tags.some(tag => tag.length > 40)) rowErrors.push("cada tag deve ter até 40 caracteres");
      else entry.tags = [...new Set(tags)];
    }
    if (raw.promotionalPrice) {
      const value = numberCell(raw.promotionalPrice);
      if (Number.isFinite(value) && value >= 0) entry.promotionalPrice = value;
      else rowErrors.push("promotionalPrice inválido");
    }
    for (const field of ["promotionStartsAt", "promotionEndsAt"] as const) {
      if (raw[field]) {
        if (Number.isFinite(Date.parse(raw[field]))) entry[field] = raw[field];
        else rowErrors.push(`${field} inválido`);
      }
    }
    if (raw.featured) {
      const value = booleanCell(raw.featured);
      if (value === null) rowErrors.push("featured deve ser true/false");
      else entry.featured = value;
    }
    if (raw.status) {
      if (["active", "hidden", "inactive"].includes(raw.status)) entry.status = raw.status;
      else rowErrors.push("status inválido");
    }
    entry.price = price;
    entry.availableStock = availableStock;
    if (raw.costPrice) {
      const value = numberCell(raw.costPrice);
      if (Number.isFinite(value) && value >= 0) entry.costPrice = value;
      else rowErrors.push("costPrice inválido");
    }
    if (raw.minimumStock) {
      const value = numberCell(raw.minimumStock);
      if (Number.isInteger(value) && value >= 0) entry.minimumStock = value;
      else rowErrors.push("minimumStock inválido");
    }
    if (raw.weightGrams) {
      const value = numberCell(raw.weightGrams);
      if (Number.isInteger(value) && value >= 0) entry.weightGrams = value;
      else rowErrors.push("weightGrams deve ser inteiro não negativo");
    }
    if (raw.attributes) {
      try {
        const parsed = JSON.parse(raw.attributes);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" ||
          Object.values(parsed).some(value => typeof value !== "string" || value.length > 100)) throw new Error();
        entry.attributes = parsed;
      } catch {
        rowErrors.push("attributes precisa ser um objeto JSON com valores de texto");
      }
    }
    if (raw.dimensionsCm) {
      try {
        const parsed = JSON.parse(raw.dimensionsCm);
        if (!parsed || ["length", "width", "height"].some(key => typeof parsed[key] !== "number" || parsed[key] < 0)) throw new Error();
        entry.dimensionsCm = parsed;
      } catch {
        rowErrors.push("dimensionsCm precisa ser um objeto JSON com comprimento, largura e altura");
      }
    }
    if (raw.variantActive) {
      const value = booleanCell(raw.variantActive);
      if (value === null) rowErrors.push("variantActive deve ser true/false");
      else entry.variantActive = value;
    }
    if (rowErrors.length) errors.push(`Linha ${rowNumber}: ${rowErrors.join("; ")}.`);
    else items.push(entry as unknown as StockCatalogImportRow);
  });
  return { items, errors };
}
