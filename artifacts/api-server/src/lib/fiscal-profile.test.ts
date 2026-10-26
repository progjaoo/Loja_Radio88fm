import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFiscalRegime,
  getCheckoutFiscalState,
  getFiscalProfileReadiness,
  guidedTaxFieldsFromPayload,
  mergeFiscalTaxPayload,
  mergeGuidedTaxPayload,
  parseAccountantNumber,
  type GuidedFiscalTaxFields,
} from "./fiscal-profile.ts";

const completePayload = {
  icms: { cst: "102" },
  pis: { cst: "07" },
  cofins: { cst: "07" },
};
const completeProfile = {
  ncm: "85183000",
  origin: "0",
  unit: "UN",
  taxUnit: "UN",
  cest: null,
  cfop: "5102",
  taxPayload: completePayload,
};

test("profile readiness accepts accountant-provided Simples Nacional codes without calculating amounts", () => {
  const result = getFiscalProfileReadiness({
    profile: completeProfile,
    taxRegime: "Simples Nacional",
    mode: "nfeio",
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.missing, []);
});

test("an empty product payload inherits accountant-provided category tax groups for readiness", () => {
  const result = getFiscalProfileReadiness({
    profile: { ...completeProfile, taxPayload: {} },
    taxRegime: "Simples Nacional",
    mode: "manual",
    categoryTaxPayload: completePayload,
  });
  assert.equal(result.complete, true);
});

test("product tax values override category defaults without discarding other category or product properties", () => {
  assert.deepEqual(mergeFiscalTaxPayload(
    {
      icms: { cst: "102", origin: "0" },
      IBSCBS: { calculationMode: "Manual", state: { rate: 1, amount: 2 }, metadata: "category" },
    },
    {
      icms: { cst: "103" },
      IBSCBS: { state: { amount: 3 }, custom: true },
      providerSpecific: { retained: true },
    },
  ), {
    icms: { cst: "103", origin: "0" },
    IBSCBS: {
      calculationMode: "Manual",
      state: { rate: 1, amount: 3 },
      metadata: "category",
      custom: true,
    },
    providerSpecific: { retained: true },
  });
});

test("profile readiness identifies every required field when a product has no profile yet", () => {
  const result = getFiscalProfileReadiness({
    profile: null,
    taxRegime: "Simples Nacional",
    mode: "manual",
  });
  assert.equal(result.complete, false);
  assert.ok(result.missing.includes("perfil fiscal do produto"));
  assert.ok(result.missing.includes("NCM com 8 dígitos"));
  assert.ok(result.missing.includes("CSOSN informado pelo contador"));
});

test("a valid preliminary NCM permits checkout while invoice fields remain unsnapshotted", () => {
  const result = getCheckoutFiscalState({
    profile: null,
    ncmSuggestion: "61091000",
    taxRegime: null,
    mode: "manual",
  });
  assert.equal(result.saleReady, true);
  assert.deepEqual(result.orderLineFiscalSnapshot, {
    fiscalNcm: null,
    fiscalOrigin: null,
    fiscalUnit: null,
    fiscalTaxUnit: null,
    fiscalCest: null,
  });
});

test("checkout does not accept a missing or malformed NCM even when invoice readiness is separate", () => {
  const result = getCheckoutFiscalState({
    profile: null,
    ncmSuggestion: "6109.10.00",
    taxRegime: "Simples Nacional",
    mode: "manual",
  });
  assert.equal(result.saleReady, false);
});

test("a complete invoice profile is snapshotted on the order line", () => {
  const result = getCheckoutFiscalState({
    profile: completeProfile,
    ncmSuggestion: null,
    taxRegime: "Simples Nacional",
    mode: "manual",
  });
  assert.equal(result.saleReady, true);
  assert.deepEqual(result.orderLineFiscalSnapshot, {
    fiscalNcm: "85183000",
    fiscalOrigin: "0",
    fiscalUnit: "UN",
    fiscalTaxUnit: "UN",
    fiscalCest: null,
  });
});

test("profile readiness requires the manual IBSCBS group for NFE.io normal-regime emission", () => {
  const result = getFiscalProfileReadiness({
    profile: { ...completeProfile, taxPayload: { ...completePayload, icms: { cst: "00" } } },
    taxRegime: "Lucro Real",
    mode: "nfeio",
  });
  assert.equal(result.complete, false);
  assert.ok(result.missing.some((message) => message.includes("CST IBS/CBS")));
  assert.ok(result.missing.some((message) => message.includes("classificação IBS/CBS")));
});

test("regime classifier handles Simples sublimite exceeded as normal-regime CRT 2", () => {
  assert.equal(classifyFiscalRegime("Simples Nacional — sublimite excedido (CRT 2)"), "normal");
});

test("readiness blocks automatic tax determination in advanced payloads", () => {
  const result = getFiscalProfileReadiness({
    profile: {
      ...completeProfile,
      taxPayload: {
        ...completePayload,
        IBSCBS: { calculationMode: "OfficialService" },
        taxDetermination: { calculationMode: "Automatic" },
      },
    },
    taxRegime: "Simples Nacional",
    mode: "nfeio",
  });
  assert.equal(result.complete, false);
  assert.ok(result.missing.some((message) => message.includes("taxDetermination")));
  assert.ok(result.missing.some((message) => message.includes("cálculo automático")));
});

test("guided values preserve advanced data and store only the numbers explicitly supplied", () => {
  const fields: GuidedFiscalTaxFields = {
    icmsCode: "00", icmsBaseTax: "100,00", icmsRate: "18", icmsAmount: "18,00",
    pisCst: "01", pisBaseTax: "", pisRate: "", pisAmount: "",
    cofinsCst: "01", cofinsBaseTax: "", cofinsRate: "", cofinsAmount: "",
    ipiCst: "", ipiBaseTax: "", ipiRate: "", ipiAmount: "",
    ibsCbsSituationCode: "", ibsCbsClassCode: "", ibsCbsBasis: "",
    ibsStateRate: "", ibsStateAmount: "", ibsMunicipalRate: "", ibsMunicipalAmount: "",
    cbsRate: "", cbsAmount: "",
  };
  const payload = mergeGuidedTaxPayload({
    icms: { cst: "20", baseTaxModality: "3", origin: "0" },
    providerSpecific: { retained: true },
  }, fields);
  assert.deepEqual(payload["icms"], {
    cst: "00",
    baseTaxModality: "3",
    origin: "0",
    baseTax: 100,
    rate: 18,
    amount: 18,
  });
  assert.deepEqual(payload["providerSpecific"], { retained: true });
  assert.deepEqual(guidedTaxFieldsFromPayload(payload).icmsAmount, "18");
  assert.equal((payload["icms"] as Record<string, unknown>)["calculated"], undefined);
  assert.equal(parseAccountantNumber("1.234,56"), 1234.56);
});

test("partial tax amount triplets stay pending and invalid CEST is rejected", () => {
  const result = getFiscalProfileReadiness({
    profile: {
      ...completeProfile,
      cest: "12345",
      taxPayload: { ...completePayload, icms: { cst: "102", baseTax: 10, rate: 18 } },
    },
    taxRegime: "Simples Nacional",
    mode: "manual",
  });
  assert.equal(result.complete, false);
  assert.ok(result.missing.some((message) => message.startsWith("CEST")));
  assert.ok(result.missing.some((message) => message.startsWith("ICMS:")));
});
