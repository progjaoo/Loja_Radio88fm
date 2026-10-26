import { GUIDED_TAX_FIELD_KEYS, type GuidedFiscalTaxFields } from "./fiscal-profile.ts";

export const FISCAL_PROFILE_CSV_COLUMNS: { key: string; label: string }[] = [
  { key: "productId", label: "product_id" },
  { key: "productName", label: "product_name" },
  { key: "sku", label: "sku" },
  { key: "ncm", label: "ncm_8_digitos" },
  { key: "origin", label: "origin_0_a_8" },
  { key: "unit", label: "unidade_comercial" },
  { key: "taxUnit", label: "unidade_tributavel" },
  { key: "cest", label: "cest_opcional_7_digitos" },
  { key: "cfop", label: "cfop_4_digitos" },
  { key: "icmsCode", label: "icms_cst_ou_csosn" },
  { key: "icmsBaseTax", label: "icms_base_informada" },
  { key: "icmsRate", label: "icms_aliquota_informada" },
  { key: "icmsAmount", label: "icms_valor_informado" },
  { key: "pisCst", label: "pis_cst" },
  { key: "pisBaseTax", label: "pis_base_informada" },
  { key: "pisRate", label: "pis_aliquota_informada" },
  { key: "pisAmount", label: "pis_valor_informado" },
  { key: "cofinsCst", label: "cofins_cst" },
  { key: "cofinsBaseTax", label: "cofins_base_informada" },
  { key: "cofinsRate", label: "cofins_aliquota_informada" },
  { key: "cofinsAmount", label: "cofins_valor_informado" },
  { key: "ipiCst", label: "ipi_cst_opcional" },
  { key: "ipiBaseTax", label: "ipi_base_informada" },
  { key: "ipiRate", label: "ipi_aliquota_informada" },
  { key: "ipiAmount", label: "ipi_valor_informado" },
  { key: "ibsCbsSituationCode", label: "ibs_cbs_cst_3_digitos" },
  { key: "ibsCbsClassCode", label: "ibs_cbs_classificacao_6_digitos" },
  { key: "ibsCbsBasis", label: "ibs_cbs_base_informada" },
  { key: "ibsStateRate", label: "ibs_estadual_aliquota_informada" },
  { key: "ibsStateAmount", label: "ibs_estadual_valor_informado" },
  { key: "ibsMunicipalRate", label: "ibs_municipal_aliquota_informada" },
  { key: "ibsMunicipalAmount", label: "ibs_municipal_valor_informado" },
  { key: "cbsRate", label: "cbs_aliquota_informada" },
  { key: "cbsAmount", label: "cbs_valor_informado" },
];

export type FiscalProfileCsvRow = {
  productId: string;
  productName: string;
  sku: string;
  ncm: string;
  origin: string;
  unit: string;
  taxUnit: string;
  cest: string;
  cfop: string;
} & GuidedFiscalTaxFields;

export function parseFiscalCsv(content: string, delimiter = ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = content.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("O CSV contém uma célula com aspas não fechadas.");
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  return rows;
}

export function fiscalCsvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function guidedFieldValuesFromCsv(
  row: string[],
  headerIndexes: Map<string, number>,
): GuidedFiscalTaxFields {
  const values = {} as GuidedFiscalTaxFields;
  for (const key of GUIDED_TAX_FIELD_KEYS) {
    const column = FISCAL_PROFILE_CSV_COLUMNS.find((item) => item.key === key);
    values[key] = column ? row[headerIndexes.get(column.label) ?? -1]?.trim() ?? "" : "";
  }
  return values;
}

export function csvValue(row: string[], headerIndexes: Map<string, number>, column: string): string {
  return row[headerIndexes.get(column) ?? -1]?.trim() ?? "";
}
