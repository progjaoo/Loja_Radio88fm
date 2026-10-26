import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidAccessKey,
  isValidCpfCnpj,
  isValidCest,
  isValidNcm,
  isValidOrigin,
  normalizeTaxNumber,
} from "./fiscal-validation.ts";

test("normalizes and validates recipient CPF/CNPJ without accepting repeated digits", () => {
  assert.equal(normalizeTaxNumber("529.982.247-25"), "52998224725");
  assert.equal(isValidCpfCnpj("529.982.247-25"), true);
  assert.equal(isValidCpfCnpj("11.222.333/0001-81"), true);
  assert.equal(isValidCpfCnpj("111.111.111-11"), false);
  assert.equal(isValidCpfCnpj("12.345.678/0001-00"), false);
});

test("validates accountant-provided NCM, origin and optional CEST", () => {
  assert.equal(isValidNcm("85183000"), true);
  assert.equal(isValidNcm("8518300"), false);
  assert.equal(isValidOrigin("8"), true);
  assert.equal(isValidOrigin("9"), false);
  assert.equal(isValidCest(null), true);
  assert.equal(isValidCest("2806100"), true);
  assert.equal(isValidCest("280610"), false);
});

test("checks the NF-e access-key check digit", () => {
  const first43 = "1".repeat(43);
  let sum = 0;
  let weight = 2;
  for (const digit of first43.split("").reverse()) {
    sum += Number(digit) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const validKey = `${first43}${remainder < 2 ? 0 : 11 - remainder}`;
  assert.equal(isValidAccessKey(validKey), true);
  const wrongDigit = validKey.endsWith("0") ? "1" : "0";
  assert.equal(isValidAccessKey(`${validKey.slice(0, 43)}${wrongDigit}`), false);
});
