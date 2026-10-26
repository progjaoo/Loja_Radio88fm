import { isValidCest, isValidNcm, isValidOrigin } from "./fiscal-validation.ts";

export type GuidedFiscalTaxFields = {
  icmsCode: string;
  icmsBaseTax: string;
  icmsRate: string;
  icmsAmount: string;
  pisCst: string;
  pisBaseTax: string;
  pisRate: string;
  pisAmount: string;
  cofinsCst: string;
  cofinsBaseTax: string;
  cofinsRate: string;
  cofinsAmount: string;
  ipiCst: string;
  ipiBaseTax: string;
  ipiRate: string;
  ipiAmount: string;
  ibsCbsSituationCode: string;
  ibsCbsClassCode: string;
  ibsCbsBasis: string;
  ibsStateRate: string;
  ibsStateAmount: string;
  ibsMunicipalRate: string;
  ibsMunicipalAmount: string;
  cbsRate: string;
  cbsAmount: string;
};

export const GUIDED_TAX_FIELD_KEYS: (keyof GuidedFiscalTaxFields)[] = [
  "icmsCode", "icmsBaseTax", "icmsRate", "icmsAmount",
  "pisCst", "pisBaseTax", "pisRate", "pisAmount",
  "cofinsCst", "cofinsBaseTax", "cofinsRate", "cofinsAmount",
  "ipiCst", "ipiBaseTax", "ipiRate", "ipiAmount",
  "ibsCbsSituationCode", "ibsCbsClassCode", "ibsCbsBasis",
  "ibsStateRate", "ibsStateAmount", "ibsMunicipalRate", "ibsMunicipalAmount",
  "cbsRate", "cbsAmount",
];

export const EMPTY_GUIDED_TAX_FIELDS: GuidedFiscalTaxFields = {
  icmsCode: "", icmsBaseTax: "", icmsRate: "", icmsAmount: "",
  pisCst: "", pisBaseTax: "", pisRate: "", pisAmount: "",
  cofinsCst: "", cofinsBaseTax: "", cofinsRate: "", cofinsAmount: "",
  ipiCst: "", ipiBaseTax: "", ipiRate: "", ipiAmount: "",
  ibsCbsSituationCode: "", ibsCbsClassCode: "", ibsCbsBasis: "",
  ibsStateRate: "", ibsStateAmount: "", ibsMunicipalRate: "", ibsMunicipalAmount: "",
  cbsRate: "", cbsAmount: "",
};

export type FiscalRegimeKind = "simples" | "normal" | "unknown";

export function classifyFiscalRegime(value: string | null | undefined): FiscalRegimeKind {
  const normalized = (value ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  if (!normalized) return "unknown";
  if (/\b(crt\s*2|sublimite excedido)\b/.test(normalized) || normalized === "2") return "normal";
  if (/\b(crt\s*1|simples|mei)\b/.test(normalized) || normalized === "1") return "simples";
  if (/\b(crt\s*3|normal|lucro)\b/.test(normalized) || normalized === "3") return "normal";
  return "unknown";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value);
}

function nestedValue(source: Record<string, unknown>, key: string, child: string): unknown {
  return record(source[key])[child];
}

export function guidedTaxFieldsFromPayload(value: Record<string, unknown> | null | undefined): GuidedFiscalTaxFields {
  const payload = record(value);
  const icms = record(payload["icms"]);
  const pis = record(payload["pis"]);
  const cofins = record(payload["cofins"]);
  const ipi = record(payload["ipi"]);
  const ibsCbs = record(payload["IBSCBS"]);
  const state = record(ibsCbs["state"]);
  const municipal = record(ibsCbs["municipal"]);
  const cbs = record(ibsCbs["cbs"]);
  return {
    icmsCode: stringValue(icms["cst"] ?? icms["csosn"]),
    icmsBaseTax: stringValue(icms["baseTax"]),
    icmsRate: stringValue(icms["rate"]),
    icmsAmount: stringValue(icms["amount"]),
    pisCst: stringValue(pis["cst"]),
    pisBaseTax: stringValue(pis["baseTax"]),
    pisRate: stringValue(pis["rate"]),
    pisAmount: stringValue(pis["amount"]),
    cofinsCst: stringValue(cofins["cst"]),
    cofinsBaseTax: stringValue(cofins["baseTax"]),
    cofinsRate: stringValue(cofins["rate"]),
    cofinsAmount: stringValue(cofins["amount"]),
    ipiCst: stringValue(ipi["cst"]),
    ipiBaseTax: stringValue(ipi["baseTax"]),
    ipiRate: stringValue(ipi["rate"]),
    ipiAmount: stringValue(ipi["amount"]),
    ibsCbsSituationCode: stringValue(ibsCbs["situationCode"]),
    ibsCbsClassCode: stringValue(ibsCbs["classCode"]),
    ibsCbsBasis: stringValue(ibsCbs["basis"]),
    ibsStateRate: stringValue(nestedValue(ibsCbs, "state", "rate")),
    ibsStateAmount: stringValue(nestedValue(ibsCbs, "state", "amount")),
    ibsMunicipalRate: stringValue(nestedValue(ibsCbs, "municipal", "rate")),
    ibsMunicipalAmount: stringValue(nestedValue(ibsCbs, "municipal", "amount")),
    cbsRate: stringValue(nestedValue(ibsCbs, "cbs", "rate")),
    cbsAmount: stringValue(nestedValue(ibsCbs, "cbs", "amount")),
  };
}

export function parseAccountantNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const brazilianThousands = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(trimmed);
  const simpleDecimal = /^\d+(?:[,.]\d+)?$/.test(trimmed);
  if (!brazilianThousands && !simpleDecimal) throw new Error("Use um número não negativo, sem separador de milhar.");
  const normalized = brazilianThousands
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed.replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error("Informe um número válido.");
  return parsed;
}

function updateScalarGroup(
  payload: Record<string, unknown>,
  groupName: string,
  source: Record<string, unknown>,
  codeKey: string,
  fields: { input: keyof GuidedFiscalTaxFields; output: string }[],
): void {
  const group = { ...record(payload[groupName]) };
  const code = stringValue(source[codeKey]).trim();
  if (code) group["cst"] = code;
  else delete group["cst"];
  for (const field of fields) {
    const input = stringValue(source[field.input]).trim();
    if (!input) {
      delete group[field.output];
      continue;
    }
    group[field.output] = parseAccountantNumber(input);
  }
  if (Object.keys(group).length) payload[groupName] = group;
  else delete payload[groupName];
}

export function mergeGuidedTaxPayload(
  existing: Record<string, unknown> | null | undefined,
  fields: GuidedFiscalTaxFields,
): Record<string, unknown> {
  const payload = structuredClone(record(existing));
  const source = fields as unknown as Record<string, unknown>;
  updateScalarGroup(payload, "icms", source, "icmsCode", [
    { input: "icmsBaseTax", output: "baseTax" },
    { input: "icmsRate", output: "rate" },
    { input: "icmsAmount", output: "amount" },
  ]);
  updateScalarGroup(payload, "pis", source, "pisCst", [
    { input: "pisBaseTax", output: "baseTax" },
    { input: "pisRate", output: "rate" },
    { input: "pisAmount", output: "amount" },
  ]);
  updateScalarGroup(payload, "cofins", source, "cofinsCst", [
    { input: "cofinsBaseTax", output: "baseTax" },
    { input: "cofinsRate", output: "rate" },
    { input: "cofinsAmount", output: "amount" },
  ]);
  updateScalarGroup(payload, "ipi", source, "ipiCst", [
    { input: "ipiBaseTax", output: "baseTax" },
    { input: "ipiRate", output: "rate" },
    { input: "ipiAmount", output: "amount" },
  ]);

  const ibsCbs = { ...record(payload["IBSCBS"]) };
  const situationCode = fields.ibsCbsSituationCode.trim();
  const classCode = fields.ibsCbsClassCode.trim();
  if (situationCode) ibsCbs["situationCode"] = situationCode;
  else delete ibsCbs["situationCode"];
  if (classCode) ibsCbs["classCode"] = classCode;
  else delete ibsCbs["classCode"];
  const basis = fields.ibsCbsBasis.trim();
  if (basis) ibsCbs["basis"] = parseAccountantNumber(basis);
  else delete ibsCbs["basis"];
  ibsCbs["calculationMode"] = "Manual";
  for (const [groupName, rateField, amountField] of [
    ["state", "ibsStateRate", "ibsStateAmount"],
    ["municipal", "ibsMunicipalRate", "ibsMunicipalAmount"],
    ["cbs", "cbsRate", "cbsAmount"],
  ] as const) {
    const group = { ...record(ibsCbs[groupName]) };
    for (const [field, key] of [[rateField, "rate"], [amountField, "amount"]] as const) {
      const value = fields[field].trim();
      if (value) group[key] = parseAccountantNumber(value);
      else delete group[key];
    }
    if (Object.keys(group).length) ibsCbs[groupName] = group;
    else delete ibsCbs[groupName];
  }
  if (situationCode || classCode || basis ||
      fields.ibsStateRate || fields.ibsStateAmount || fields.ibsMunicipalRate ||
      fields.ibsMunicipalAmount || fields.cbsRate || fields.cbsAmount) {
    payload["IBSCBS"] = ibsCbs;
  } else if (Object.keys(ibsCbs).length <= 1 && ibsCbs["calculationMode"] === "Manual") {
    delete payload["IBSCBS"];
  }
  return payload;
}

export function mergeFiscalTaxPayload(
  categoryPayload: Record<string, unknown> | null | undefined,
  productPayload: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const merged = { ...record(categoryPayload), ...record(productPayload) };
  for (const groupName of ["icms", "pis", "cofins", "ipi", "IBSCBS"]) {
    const categoryGroup = record(record(categoryPayload)[groupName]);
    const productGroup = record(record(productPayload)[groupName]);
    if (!Object.keys(categoryGroup).length && !Object.keys(productGroup).length) continue;
    const group = { ...categoryGroup, ...productGroup };
    if (groupName === "IBSCBS") {
      for (const nestedName of ["state", "municipal", "cbs"]) {
        const nested = {
          ...record(categoryGroup[nestedName]),
          ...record(productGroup[nestedName]),
        };
        if (Object.keys(nested).length) group[nestedName] = nested;
      }
    }
    merged[groupName] = group;
  }
  return merged;
}

function hasCode(group: Record<string, unknown>): boolean {
  return typeof (group["cst"] ?? group["csosn"]) === "string" &&
    String(group["cst"] ?? group["csosn"]).trim().length > 0;
}

function hasNumber(value: unknown): boolean {
  if (value == null || value === "") return false;
  return Number.isFinite(typeof value === "number" ? value : Number(value));
}

function validateAmountTriplet(group: Record<string, unknown>, label: string, missing: string[]): void {
  const keys = ["baseTax", "rate", "amount"] as const;
  const present = keys.filter((key) => hasNumber(group[key])).length;
  if (present > 0 && present < keys.length) {
    missing.push(`${label}: informe base, alíquota e valor do contador, ou deixe os três vazios`);
  }
}

export type FiscalProfileReadinessInput = {
  profile: {
    ncm: string;
    origin: string;
    unit: string;
    taxUnit: string;
    cest: string | null;
    cfop: string | null;
    taxPayload: Record<string, unknown> | null;
  } | null;
  taxRegime: string | null | undefined;
  mode: string;
  categoryCfop?: string | null;
  defaultCfop?: string | null;
  categoryTaxPayload?: Record<string, unknown> | null;
};

export function getFiscalProfileReadiness(input: FiscalProfileReadinessInput): {
  complete: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  const profile = input.profile ?? {
    ncm: "",
    origin: "",
    unit: "",
    taxUnit: "",
    cest: null,
    cfop: null,
    taxPayload: null,
  };
  const regime = classifyFiscalRegime(input.taxRegime);
  if (regime === "unknown") missing.push("regime tributário da empresa reconhecido");
  if (!input.profile) missing.push("perfil fiscal do produto");
  if (!isValidNcm(profile.ncm)) missing.push("NCM com 8 dígitos");
  if (!isValidOrigin(profile.origin)) missing.push("origem de 0 a 8");
  if (!profile.unit.trim()) missing.push("unidade comercial");
  if (!profile.taxUnit.trim()) missing.push("unidade tributável");
  if (!isValidCest(profile.cest)) missing.push("CEST com 7 dígitos ou vazio");
  const cfop = profile.cfop || input.categoryCfop || input.defaultCfop || "";
  if (!/^\d{4}$/.test(cfop)) missing.push("CFOP com 4 dígitos");

  const tax = mergeFiscalTaxPayload(input.categoryTaxPayload, profile.taxPayload);
  if ("taxDetermination" in tax) missing.push("cálculo automático de tributos não permitido; remova taxDetermination");
  const icms = record(tax["icms"]);
  const pis = record(tax["pis"]);
  const cofins = record(tax["cofins"]);
  const ipi = record(tax["ipi"]);
  const icmsCode = String(icms["cst"] ?? icms["csosn"] ?? "");
  if (!hasCode(icms)) missing.push(regime === "simples" ? "CSOSN informado pelo contador" : "CST de ICMS informado pelo contador");
  else if (regime === "simples" && !/^\d{3}$/.test(icmsCode)) missing.push("CSOSN com 3 dígitos");
  else if (regime === "normal" && !/^\d{2}$/.test(icmsCode)) missing.push("CST de ICMS com 2 dígitos");
  if (!hasCode(pis)) missing.push("CST de PIS informado pelo contador");
  else if (!/^\d{2}$/.test(String(pis["cst"]))) missing.push("CST de PIS com 2 dígitos");
  if (!hasCode(cofins)) missing.push("CST de COFINS informado pelo contador");
  else if (!/^\d{2}$/.test(String(cofins["cst"]))) missing.push("CST de COFINS com 2 dígitos");

  validateAmountTriplet(icms, "ICMS", missing);
  validateAmountTriplet(pis, "PIS", missing);
  validateAmountTriplet(cofins, "COFINS", missing);
  if (Object.keys(ipi).length) {
    if (!hasCode(ipi) || !/^\d{2}$/.test(String(ipi["cst"] ?? ""))) missing.push("CST de IPI com 2 dígitos");
    validateAmountTriplet(ipi, "IPI", missing);
  }

  const ibsCbs = record(tax["IBSCBS"]);
  if (Object.keys(ibsCbs).length && ibsCbs["calculationMode"] !== "Manual") {
    missing.push("cálculo automático IBS/CBS não permitido; use apenas modo Manual");
  }
  if (regime === "normal" && input.mode === "nfeio") {
    if (!/^\d{3}$/.test(String(ibsCbs["situationCode"] ?? ""))) missing.push("CST IBS/CBS com 3 dígitos");
    if (!/^\d{6}$/.test(String(ibsCbs["classCode"] ?? ""))) missing.push("classificação IBS/CBS com 6 dígitos");
    if (ibsCbs["calculationMode"] !== "Manual") missing.push("IBS/CBS em modo Manual com valores do contador");
    const basis = ibsCbs["basis"];
    const groups = [record(ibsCbs["state"]), record(ibsCbs["municipal"]), record(ibsCbs["cbs"])];
    for (const [label, group] of [["IBS estadual", groups[0]!], ["IBS municipal", groups[1]!], ["CBS", groups[2]!]] as const) {
      const ratePresent = hasNumber(group["rate"]);
      const amountPresent = hasNumber(group["amount"]);
      if (ratePresent !== amountPresent || (ratePresent && !hasNumber(basis))) {
        missing.push(`${label}: informe base, alíquota e valor do contador`);
      }
    }
  }
  return { complete: missing.length === 0, missing };
}

export function getCheckoutFiscalState(input: FiscalProfileReadinessInput & {
  ncmSuggestion?: string | null;
}): {
  saleReady: boolean;
  orderLineFiscalSnapshot: {
    fiscalNcm: string | null;
    fiscalOrigin: string | null;
    fiscalUnit: string | null;
    fiscalTaxUnit: string | null;
    fiscalCest: string | null;
  };
} {
  const readiness = getFiscalProfileReadiness(input);
  const profile = input.profile;
  const saleReady = isValidNcm(profile?.ncm ?? "") || isValidNcm(input.ncmSuggestion ?? "");
  const snapshot = readiness.complete && profile
    ? {
        fiscalNcm: profile.ncm,
        fiscalOrigin: profile.origin,
        fiscalUnit: profile.unit,
        fiscalTaxUnit: profile.taxUnit,
        fiscalCest: profile.cest,
      }
    : { fiscalNcm: null, fiscalOrigin: null, fiscalUnit: null, fiscalTaxUnit: null, fiscalCest: null };

  return {
    saleReady,
    orderLineFiscalSnapshot: snapshot,
  };
}
