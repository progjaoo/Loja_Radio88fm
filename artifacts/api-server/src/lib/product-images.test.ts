import assert from "node:assert/strict";
import test from "node:test";
import { getPrimaryImageUrl, MAX_PRODUCT_IMAGES, normalizeProductImages, type ProductImageDraft } from "./product-images.ts";

const image = (sortOrder: number, isPrimary = false): ProductImageDraft => ({
  url: `https://images.example.test/${sortOrder}.webp`,
  alt: `Foto ${sortOrder}`,
  sortOrder,
  isPrimary,
});

test("allows no photos and preserves a missing gallery during partial updates", () => {
  assert.deepEqual(normalizeProductImages(undefined, null, "Produto"), []);
  assert.equal(normalizeProductImages(undefined, undefined, "Produto", true), undefined);
});

test("converts a legacy cover URL into the single primary image", () => {
  const gallery = normalizeProductImages(undefined, "https://images.example.test/legacy.webp", "Rádio");
  assert.deepEqual(gallery, [{
    url: "https://images.example.test/legacy.webp",
    alt: "Rádio",
    sortOrder: 0,
    isPrimary: true,
  }]);
});

test("accepts up to five images, sorts them, and assigns one cover when omitted", () => {
  const gallery = normalizeProductImages([image(2), image(0), image(1), image(3), image(4)], undefined, "Produto");
  assert.equal(gallery?.length, MAX_PRODUCT_IMAGES);
  assert.deepEqual(gallery?.map((entry) => entry.sortOrder), [0, 1, 2, 3, 4]);
  assert.deepEqual(gallery?.filter((entry) => entry.isPrimary).map((entry) => entry.sortOrder), [0]);
});

test("rejects more than five images, duplicate order positions, and multiple covers", () => {
  assert.equal(normalizeProductImages(Array.from({ length: 6 }, (_, index) => image(index)), undefined, "Produto"), null);
  assert.equal(normalizeProductImages([image(0), image(0)], undefined, "Produto"), null);
  assert.equal(normalizeProductImages([image(0, true), image(1, true)], undefined, "Produto"), null);
});

test("keeps the explicit cover URL authoritative", () => {
  assert.equal(getPrimaryImageUrl([image(0), { ...image(1), isPrimary: true }]), "https://images.example.test/1.webp");
  assert.equal(getPrimaryImageUrl([image(0)]), "https://images.example.test/0.webp");
  assert.equal(getPrimaryImageUrl(undefined), null);
});
