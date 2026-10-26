import assert from "node:assert/strict";
import test from "node:test";
import { formatCents, fromCents, parseCents, toCents } from "./currency.ts";

test("parses digits as cents from right to left", () => {
  assert.equal(parseCents("1"), 1);
  assert.equal(parseCents("12"), 12);
  assert.equal(parseCents("123"), 123);
  assert.equal(parseCents("R$ 1.234,56"), 123456);
});

test("formats cents as Brazilian currency", () => {
  assert.equal(formatCents(1), "R$ 0,01");
  assert.equal(formatCents(12), "R$ 0,12");
  assert.equal(formatCents(123), "R$ 1,23");
  assert.equal(formatCents(123456), "R$ 1.234,56");
});

test("converts legacy decimal amounts to and from integer cents", () => {
  assert.equal(toCents(12.34), 1234);
  assert.equal(fromCents(1234), 12.34);
  assert.equal(toCents(-1), 0);
});
