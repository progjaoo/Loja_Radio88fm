import assert from "node:assert/strict";
import test from "node:test";
import { effectiveVariantPriceCents, isValidPromotionWindow } from "./pricing.ts";

const start = new Date("2026-10-01T00:00:00.000Z");
const end = new Date("2026-10-31T23:59:59.000Z");
const promotion = {
  promotionalPriceCents: 7900,
  promotionStartsAt: start,
  promotionEndsAt: end,
};

test("applies an active promotion to a more expensive variant", () => {
  assert.equal(effectiveVariantPriceCents(promotion, 12000, new Date("2026-10-08T12:00:00.000Z")), 7900);
});

test("a product-level promotion never raises a cheaper variant price", () => {
  assert.equal(effectiveVariantPriceCents(promotion, 6900, new Date("2026-10-08T12:00:00.000Z")), 6900);
});

test("does not apply a promotion before its start or after its end", () => {
  assert.equal(effectiveVariantPriceCents(promotion, 12000, new Date("2026-09-30T23:59:59.000Z")), 12000);
  assert.equal(effectiveVariantPriceCents(promotion, 12000, new Date("2026-11-01T00:00:00.000Z")), 12000);
});

test("an open-ended promotion is active when its configured bound allows it", () => {
  assert.equal(
    effectiveVariantPriceCents(
      { promotionalPriceCents: 0, promotionStartsAt: null, promotionEndsAt: null },
      12000,
      new Date("2026-10-08T12:00:00.000Z"),
    ),
    0,
  );
});

test("rejects an inverted promotion window but accepts open-ended bounds", () => {
  assert.equal(isValidPromotionWindow(start, end), true);
  assert.equal(isValidPromotionWindow(end, start), false);
  assert.equal(isValidPromotionWindow(start, null), true);
  assert.equal(isValidPromotionWindow(null, end), true);
});
