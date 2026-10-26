import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import * as fixture from "./test-support/order-route.ts";

// Bundle the production route and its actual Zod schemas/order serializer.
// Only persistence, auth identity and outbound realtime are isolated.
const directory = await mkdtemp(join(tmpdir(), "radio88-order-tests-"));
after(() => rm(directory, { recursive: true, force: true }));
const helper = new URL("./test-support/order-route.ts", import.meta.url).href;
const schemaRequire = createRequire(new URL("../../../../lib/api-zod/package.json", import.meta.url));
const serverRequire = createRequire(new URL("../../package.json", import.meta.url));
await build({
  entryPoints: [fileURLToPath(new URL("../routes/admin.ts", import.meta.url))],
  outfile: `${directory}/admin.mjs`, bundle: true, platform: "node", format: "esm",
  packages: "external", conditions: ["workspace"],
  plugins: [{
    name: "isolated-order-dependencies",
    setup(build) {
      // Workspace TS needs bundling; Node's strip-only loader cannot resolve
      // its extensionless imports. Keep third-party packages external.
      build.onResolve({ filter: /^@workspace\/api-zod$/ }, () => ({
        path: fileURLToPath(new URL("../../../../lib/api-zod/src/index.ts", import.meta.url)),
      }));
      build.onResolve({ filter: /^zod(?:\/.*)?$/ }, (args) => ({ path: schemaRequire.resolve(args.path) }));
      build.onResolve({ filter: /^express$/ }, () => ({ path: serverRequire.resolve("express"), external: true }));
      build.onResolve({ filter: /^@workspace\/db$|^drizzle-orm$|\/middlewares\/auth$|\/lib\/rbac$|\/lib\/realtime$/ }, (args) => ({
        path: args.path, namespace: "order-fixture",
      }));
      build.onLoad({ filter: /.*/, namespace: "order-fixture" }, (args) => {
        const names = args.path === "@workspace/db"
          ? fixture.tableNames.map((name) => `export const ${name} = fixture.tables.${name};`).join("\n")
          : "";
        return {
          contents: `import * as fixture from ${JSON.stringify(helper)};
            export * from ${JSON.stringify(helper)};
            ${names}`,
          loader: "js",
        };
      });
      build.onResolve({ filter: /^file:/ }, (args) => ({ path: args.path, external: true }));
    },
  }],
});
const { default: router } = await import(pathToFileURL(`${directory}/admin.mjs`).href);
const route = router.stack.find((layer: any) => layer.route?.path === "/admin/orders/:orderId/status").route;
const handler = route.stack.at(-1).handle;

async function update(body: Record<string, unknown>, orderId = fixture.ORDER_ID) {
  const response = {
    statusCode: 200,
    body: undefined as any,
    status(value: number) { this.statusCode = value; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
  await handler({ params: { orderId }, body }, response);
  return response;
}
function snapshot() { return structuredClone(fixture.rows); }
async function rejected(body: Record<string, unknown>, status = 400, message?: RegExp) {
  const before = snapshot();
  const response = await update(body);
  assert.equal(response.statusCode, status);
  if (message) assert.match(response.body.error, message);
  assert.deepEqual(fixture.rows, before, "rejection must not write order, payment, stock, email or audit");
  assert.deepEqual(fixture.broadcasts, [], "rejection must not broadcast");
  return response;
}
function assertInventory(stock: number, reservedStock: number, status: string) {
  assert.equal(fixture.rows.productVariantsTable[0].stock, stock);
  assert.equal(fixture.rows.productVariantsTable[0].reservedStock, reservedStock);
  assert.equal(fixture.rows.stockReservationsTable[0].status, status);
}
function assertMovement(expected: Record<string, unknown>) {
  assert.equal(fixture.rows.stockMovementsTable.length, 1);
  assert.deepEqual(fixture.rows.stockMovementsTable[0], {
    variantId: fixture.VARIANT_ID, actorId: "operator", orderId: fixture.ORDER_ID,
    ...expected,
  });
}

const statuses = ["awaiting_payment", "paid", "packing", "shipped", "delivered", "picked_up", "cancelled", "returned"];
// Independent expected matrix for each order lifecycle state.
const transitions: Record<string, string[]> = {
  awaiting_payment: ["paid", "cancelled"],
  paid: ["packing", "cancelled", "picked_up"],
  packing: ["shipped", "cancelled", "picked_up"],
  shipped: ["delivered", "returned"],
  delivered: ["returned"],
  picked_up: ["returned"],
  cancelled: [],
  returned: [],
};
for (const from of statuses) {
  for (const to of statuses) {
    test(`order transition ${from} -> ${to}`, async () => {
      const payment = from === "awaiting_payment" || from === "cancelled" ? "pending"
        : from === "returned" ? "refunded" : "paid";
      fixture.reset(from, payment);
      const allowed = from === to || transitions[from].includes(to);
      const refund = from !== to && payment === "paid" && (to === "cancelled" || to === "returned");
      const body = { status: to, ...(refund ? { paymentStatus: "refunded" } : {}) };
      // The current route rejects repeat refunded requests, even without a stage change.
      if (!allowed || from === "returned" && from === to) {
        await rejected(body);
        return;
      }
      const beforeStock = structuredClone(fixture.rows.productVariantsTable);
      const beforeReservations = structuredClone(fixture.rows.stockReservationsTable);
      const response = await update(body);
      assert.equal(response.statusCode, 200, JSON.stringify(response.body));
      assert.equal(response.body.status, to);
      assert.equal(response.body.paymentStatus, to === "paid" ? "paid" : refund ? "refunded" : payment);
      assert.equal(fixture.rows.paymentsTable[0].status, response.body.paymentStatus);
      if (from === "awaiting_payment" && to === "paid") {
        assertInventory(8, 0, "committed");
        assert.equal(fixture.rows.stockMovementsTable[0].movementType, "sale");
      } else if (from !== to && (to === "cancelled" || to === "returned")) {
        assertInventory(10, 0, "released");
        assert.equal(fixture.rows.stockMovementsTable[0].delta, payment === "paid" ? 2 : 0);
        assert.equal(fixture.rows.stockMovementsTable[0].reservedDelta, payment === "paid" ? 0 : -2);
      } else {
        assert.deepEqual(fixture.rows.productVariantsTable, beforeStock);
        assert.deepEqual(fixture.rows.stockReservationsTable, beforeReservations);
        assert.equal(fixture.rows.stockMovementsTable.length, 0);
      }
    });
  }
}

test("delivery orders cannot be marked as picked up", async () => {
  fixture.reset("packing", "paid", "delivery");
  await rejected({ status: "picked_up" });
});

for (const body of [{ status: "paid" }, { paymentStatus: "paid" }]) {
  test(`manual confirmation through ${Object.keys(body)[0]} commits reserved inventory once`, async () => {
    fixture.reset();
    const response = await update(body);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, "paid");
    assert.equal(response.body.paymentStatus, "paid");
    assertInventory(8, 0, "committed");
    assertMovement({
      delta: -2, reservedDelta: -2, movementType: "sale", quantityBefore: 10,
      quantityAfter: 8, reason: "Venda confirmada do pedido 88-TEST",
    });
    assert.equal(fixture.rows.paymentsTable[0].confirmedBy, "operator");
    assert.ok(fixture.rows.paymentsTable[0].confirmedAt instanceof Date);
    assert.equal(fixture.rows.auditEventsTable[0].details.fromPaymentStatus, "pending");
    assert.equal(fixture.rows.emailOutboxTable[0].payload.toPaymentStatus, "paid");
    assert.ok(fixture.locks.includes("ordersTable"));
    assert.ok(fixture.locks.includes("stockReservationsTable"));
    assert.ok(fixture.locks.includes("productVariantsTable"));
    assert.deepEqual(fixture.broadcasts, [
      ["order", fixture.ORDER_ID, "customer"], ["stock", [fixture.VARIANT_ID]],
    ]);
    fixture.broadcasts.length = 0;
    if ("paymentStatus" in body) await rejected(body, 400, /pendente/);
    else {
      assert.equal((await update(body)).statusCode, 200);
      assertInventory(8, 0, "committed");
      assert.equal(fixture.rows.stockMovementsTable.length, 1);
      assert.equal(fixture.rows.emailOutboxTable.length, 1);
    }
  });
}

test("unpaid cancellation releases reservation without increasing physical stock", async () => {
  fixture.reset();
  assert.equal((await update({ status: "cancelled" })).statusCode, 200);
  assertInventory(10, 0, "released");
  assertMovement({
    delta: 0, reservedDelta: -2, movementType: "cancellation", quantityBefore: 10,
    quantityAfter: 10, reason: "Liberação de estoque por cancelamento 88-TEST",
  });
  assert.equal((await update({ status: "cancelled" })).statusCode, 200);
  assertInventory(10, 0, "released");
  assert.equal(fixture.rows.stockMovementsTable.length, 1);
});

test("failed pending payment cancels and releases inventory", async () => {
  fixture.reset();
  const response = await update({ paymentStatus: "failed" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "cancelled");
  assert.equal(response.body.paymentStatus, "failed");
  assert.equal(fixture.rows.paymentsTable[0].status, "failed");
  assertInventory(10, 0, "released");
  assert.equal(fixture.rows.stockMovementsTable[0].movementType, "cancellation");
});

for (const [from, to, movementType] of [
  ["paid", "cancelled", "cancellation"],
  ["packing", "cancelled", "cancellation"],
  ["shipped", "returned", "return"],
  ["delivered", "returned", "return"],
]) {
  test(`paid ${from} requires refund to become ${to}, then restores committed stock`, async () => {
    fixture.reset(from, "paid");
    await rejected({ status: to });
    await rejected({ paymentStatus: "refunded" }, 400);
    const response = await update({ status: to, paymentStatus: "refunded" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.paymentStatus, "refunded");
    assert.equal(fixture.rows.paymentsTable[0].status, "refunded");
    assertInventory(10, 0, "released");
    assertMovement({
      delta: 2, reservedDelta: 0, movementType, quantityBefore: 8, quantityAfter: 10,
      reason: `Reposição por ${to === "returned" ? "devolução" : "cancelamento"} do pedido 88-TEST`,
    });
    fixture.broadcasts.length = 0;
    await rejected({ status: to, paymentStatus: "refunded" });
  });
}

for (const [status, payment, body] of [
  ["awaiting_payment", "pending", { status: "cancelled", paymentStatus: "refunded" }],
  ["cancelled", "failed", { paymentStatus: "refunded" }],
  ["cancelled", "pending", { paymentStatus: "paid" }],
  ["cancelled", "failed", { status: "paid" }],
  ["returned", "refunded", { paymentStatus: "paid" }],
  ["paid", "paid", { paymentStatus: "pending" }],
  ["paid", "paid", { paymentStatus: "failed" }],
  ["paid", "paid", { paymentStatus: "paid" }],
  ["packing", "pending", { status: "shipped" }],
  ["shipped", "pending", { status: "delivered" }],
] as const) {
  test(`rejects unsafe payment change ${status}/${payment} ${JSON.stringify(body)}`, async () => {
    fixture.reset(status, payment);
    await rejected(body);
  });
}

for (const defect of ["missing variant", "low stock", "low reserved stock", "guarded update"]) {
  test(`confirmation with ${defect} rolls back all writes`, async () => {
    fixture.reset();
    if (defect === "missing variant") fixture.rows.productVariantsTable.length = 0;
    if (defect === "low stock") fixture.rows.productVariantsTable[0].stock = 1;
    if (defect === "low reserved stock") fixture.rows.productVariantsTable[0].reservedStock = 1;
    if (defect === "guarded update") fixture.setFailedUpdate("productVariantsTable");
    await rejected({ paymentStatus: "paid" }, 409, /estoque reservado/);
  });
}

test("a later failing reservation rolls back an earlier sale in the same transaction", async () => {
  fixture.reset();
  fixture.rows.stockReservationsTable.push({
    id: "other", orderId: fixture.ORDER_ID, variantId: "missing", quantity: 1, status: "reserved",
  });
  await rejected({ paymentStatus: "paid" }, 409);
});

for (const paid of [false, true]) {
  test(`${paid ? "confirmation" : "cancellation"} preserves stock reserved by another order`, async () => {
    fixture.reset();
    fixture.rows.productVariantsTable[0].reservedStock = 5;
    fixture.rows.stockReservationsTable.push({
      id: "foreign", orderId: "another-order", variantId: fixture.VARIANT_ID,
      quantity: 3, status: "reserved",
    });
    assert.equal((await update(paid ? { paymentStatus: "paid" } : { status: "cancelled" })).statusCode, 200);
    assertInventory(paid ? 8 : 10, 3, paid ? "committed" : "released");
    assert.equal(fixture.rows.stockReservationsTable[1].status, "reserved");
    assert.equal(fixture.rows.stockMovementsTable.length, 1);
  });
}

test("confirmation processes each variant and only reservations still reserved", async () => {
  fixture.reset();
  fixture.rows.productVariantsTable.push({ id: "second", stock: 12, reservedStock: 3 });
  fixture.rows.stockReservationsTable.push(
    { id: "second-reservation", orderId: fixture.ORDER_ID, variantId: "second", quantity: 3, status: "reserved" },
    { id: "already-committed", orderId: fixture.ORDER_ID, variantId: "missing", quantity: 9, status: "committed" },
    { id: "released", orderId: fixture.ORDER_ID, variantId: "missing", quantity: 9, status: "released" },
  );
  assert.equal((await update({ paymentStatus: "paid" })).statusCode, 200);
  assertInventory(8, 0, "committed");
  assert.equal(fixture.rows.productVariantsTable[1].stock, 9);
  assert.equal(fixture.rows.productVariantsTable[1].reservedStock, 0);
  assert.equal(fixture.rows.stockReservationsTable[1].status, "committed");
  assert.equal(fixture.rows.stockMovementsTable.length, 2);
  assert.deepEqual(fixture.rows.stockMovementsTable.map((row) => ({
    delta: row.delta, reservedDelta: row.reservedDelta, movementType: row.movementType,
  })), [
    { delta: -2, reservedDelta: -2, movementType: "sale" },
    { delta: -3, reservedDelta: -3, movementType: "sale" },
  ]);
});

test("a later failing cancellation rolls back an earlier inventory release", async () => {
  fixture.reset();
  fixture.rows.stockReservationsTable.push({
    id: "other", orderId: fixture.ORDER_ID, variantId: "missing", quantity: 1, status: "reserved",
  });
  await rejected({ status: "cancelled" }, 409);
});

for (const paid of [false, true]) {
  for (const defect of ["missing variant", "guarded update", ...(!paid ? ["low reserved stock"] : [])]) {
    test(`cancelling ${paid ? "paid" : "unpaid"} order with ${defect} is atomic`, async () => {
      fixture.reset(paid ? "paid" : "awaiting_payment", paid ? "paid" : "pending");
      if (defect === "missing variant") fixture.rows.productVariantsTable.length = 0;
      if (defect === "low reserved stock") fixture.rows.productVariantsTable[0].reservedStock = 1;
      if (defect === "guarded update") fixture.setFailedUpdate("productVariantsTable");
      await rejected({ status: "cancelled", ...(paid ? { paymentStatus: "refunded" } : {}) }, 409);
    });
  }
}

test("released and unrelated reservations never generate stock movements", async () => {
  fixture.reset();
  fixture.rows.stockReservationsTable.push(
    { id: "released", orderId: fixture.ORDER_ID, variantId: "missing", quantity: 9, status: "released" },
    { id: "foreign", orderId: "another-order", variantId: "missing", quantity: 9, status: "reserved" },
  );
  assert.equal((await update({ status: "cancelled" })).statusCode, 200);
  assertInventory(10, 0, "released");
  assert.equal(fixture.rows.stockMovementsTable.length, 1);
  assert.equal(fixture.rows.stockReservationsTable[2].status, "reserved");
});

test("guest order status updates use the saved customer email without an account profile", async () => {
  fixture.reset();
  fixture.rows.ordersTable[0].userId = null;
  fixture.rows.ordersTable[0].customerName = "Cliente visitante";
  fixture.rows.ordersTable[0].customerEmail = "visitante@example.test";
  fixture.rows.profilesTable.length = 0;

  const response = await update({ paymentStatus: "paid" });
  assert.equal(response.statusCode, 200);
  assertInventory(8, 0, "committed");
  assert.equal(fixture.rows.emailOutboxTable.length, 1);
  assert.equal(fixture.rows.emailOutboxTable[0].recipient, "visitante@example.test");
  assert.equal(fixture.rows.emailOutboxTable[0].userId, null);
  assert.equal(fixture.rows.emailOutboxTable[0].eventType, "order_status_updated");
  assert.deepEqual(fixture.broadcasts, [
    ["order", fixture.ORDER_ID, null],
    ["stock", [fixture.VARIANT_ID]],
  ]);
});

test("invalid input and missing orders fail without mutation", async () => {
  fixture.reset();
  await rejected({ status: "unknown" });
  await rejected({ paymentStatus: "unknown" });
  const before = snapshot();
  assert.equal((await update({ status: "paid" }, "00000000-0000-4000-8000-000000000099")).statusCode, 404);
  assert.deepEqual(fixture.rows, before);
});

for (const body of [{ status: "paid" }, { paymentStatus: "paid" }, { status: "cancelled", paymentStatus: "refunded" }]) {
  test(`payment-specific permission is required for ${JSON.stringify(body)}`, async () => {
    fixture.reset(body.paymentStatus === "refunded" ? "paid" : "awaiting_payment",
      body.paymentStatus === "refunded" ? "paid" : "pending");
    fixture.setPermissions(["orders:update"]);
    const response = await rejected(body, 403);
    assert.deepEqual(response.body.requiredPermissions,
      [body.paymentStatus === "refunded" ? "payments:refund" : "payments:confirm"]);
  });
}
