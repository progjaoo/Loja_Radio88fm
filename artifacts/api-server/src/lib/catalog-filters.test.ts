import assert from "node:assert/strict";
import test from "node:test";
import { matchesCatalogSearch, matchesPriceRange, normalizeCatalogSearch } from "./catalog-filters.ts";

test("the same variant must satisfy both price bounds", () => {
  assert.equal(matchesPriceRange([10, 100], 20, 80), false);
  assert.equal(matchesPriceRange([10, 50, 100], 20, 80), true);
  assert.equal(matchesPriceRange([50], 50, 50), true);
  assert.equal(matchesPriceRange([50], 60, 40), false);
  assert.equal(matchesPriceRange([], undefined, undefined), true);
});
test("catalog search ignores accents, case and surrounding whitespace", () => {
  assert.equal(normalizeCatalogSearch("  FREQUÊNCIA  "), "frequencia");
});

test("catalog search matches product categories as well as product text", () => {
  assert.equal(matchesCatalogSearch(" camisa ", ["Camiseta Rádio 88", "Descrição", "Camisas"]), true);
  assert.equal(matchesCatalogSearch("acessorios", ["Copo Rádio 88", null, "Acessórios"]), true);
  assert.equal(matchesCatalogSearch("garrafa", ["Copo Rádio 88", "Acessórios"]), false);
});
