import assert from "node:assert/strict";
import test from "node:test";
import { buildPriceDropEmailRows } from "./price-drop-notifications.ts";

test("queues opted-in customer alerts with the precise variant price decrease", () => {
  const rows = buildPriceDropEmailRows(
    [{ userId: "listener-1", email: "listener@example.test" }],
    "Camiseta Rádio 88",
    12990,
    9990,
    "Tamanho M",
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, "listener-1");
  assert.equal(rows[0].recipient, "listener@example.test");
  assert.equal(rows[0].eventType, "price_drop");
  assert.deepEqual(rows[0].payload, {
    productName: "Camiseta Rádio 88",
    variantName: "Tamanho M",
    previousPrice: 129.9,
    currentPrice: 99.9,
  });
});

test("does not queue a price-drop alert when the effective price is unchanged or higher", () => {
  const subscribers = [{ userId: "listener-1", email: "listener@example.test" }];

  assert.deepEqual(buildPriceDropEmailRows(subscribers, "Produto", 10000, 10000), []);
  assert.deepEqual(buildPriceDropEmailRows(subscribers, "Produto", 10000, 12000), []);
});
