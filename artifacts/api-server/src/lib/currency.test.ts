import assert from "node:assert/strict";
import test from "node:test";
import { centsToReais, reaisToCents } from "./currency.ts";

test("converts decimal reais to exact integer cents", () => {
  assert.equal(reaisToCents(19.9), 1990);
  assert.equal(reaisToCents(0), 0);
});

test("converts cents back to an API-compatible BRL number", () => {
  assert.equal(centsToReais(15990), 159.9);
});

test("rejects invalid and unsafe monetary values", () => {
  assert.throws(() => reaisToCents(Number.NaN), RangeError);
  assert.throws(() => reaisToCents(-1), RangeError);
  assert.throws(() => centsToReais(Number.MAX_SAFE_INTEGER + 1), RangeError);
});
