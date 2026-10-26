import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import * as fixture from "./test-support/superfrete-labels.ts";

const directory = await mkdtemp(join(tmpdir(), "radio88-superfrete-tests-"));
after(() => rm(directory, { recursive: true, force: true }));
const helper = new URL("./test-support/superfrete-labels.ts", import.meta.url).href;
await build({
  entryPoints: [fileURLToPath(new URL("./superfrete-labels.ts", import.meta.url))],
  outfile: `${directory}/labels.mjs`, bundle: true, platform: "node", format: "esm", packages: "external",
  define: { "process.env.SUPERFRETE_BASE_URL": '"https://sandbox.superfrete.com"' },
  plugins: [{
    name: "label-test-dependencies",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$|^drizzle-orm$|^\.\/orders$|^\.\/superfrete$|^\.\/shipping-settings$/ },
        args => ({ path: args.path, namespace: "label-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "label-fixture" }, () => ({
        contents: `export * from ${JSON.stringify(helper)};`, loader: "js",
      }));
      builder.onResolve({ filter: /^file:/ }, args => ({ path: args.path, external: true }));
    },
  }],
});
const service = await import(pathToFileURL(`${directory}/labels.mjs`).href);

test("concurrent calls and subsequent retry create exactly one label", async () => {
  fixture.reset();
  const attempts = await Promise.allSettled([
    service.adicionarEtiqueta({ orderId: fixture.orderId }),
    service.adicionarEtiqueta({ orderId: fixture.orderId }),
  ]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(fixture.calls.filter(call => call.path === "/api/v0/cart").length, 1);
  assert.equal(fixture.order.superfreteLabelId, "label-test");
  assert.ok(fixture.order.shippingLabelAttemptAt);
  const retry = await service.adicionarEtiqueta({ orderId: fixture.orderId });
  assert.equal(retry.id, "label-test");
  assert.equal(fixture.calls.filter(call => call.path === "/api/v0/cart").length, 1);
});

test("lost creation response persists a durable claim and blocks duplicate issuance", async () => {
  fixture.reset(); fixture.setCreationFailure(true);
  await assert.rejects(service.adicionarEtiqueta({ orderId: fixture.orderId }), /Timeout/);
  assert.equal(fixture.order.shippingLabelStatus, "reconciliation_required");
  assert.ok(fixture.order.shippingLabelAttemptAt);
  fixture.setCreationFailure(false);
  await assert.rejects(service.adicionarEtiqueta({ orderId: fixture.orderId }), /tentativa/);
  assert.equal(fixture.calls.filter(call => call.path === "/api/v0/cart").length, 1);
  const reconciled = await service.reconciliarEtiqueta(fixture.orderId, "label-test");
  assert.equal(reconciled.id, "label-test");
  assert.equal(fixture.order.superfreteLabelId, "label-test");
  await service.adicionarEtiqueta({ orderId: fixture.orderId });
  assert.equal(fixture.calls.filter(call => call.path === "/api/v0/cart").length, 1);
});

test("unpaid orders and missing fiscal data do not claim or issue labels", async () => {
  fixture.reset(); fixture.order.paymentStatus = "pending";
  await assert.rejects(service.adicionarEtiqueta({ orderId: fixture.orderId }), /pago/);
  assert.equal(fixture.calls.length, 0);
  fixture.order.paymentStatus = "paid";
  fixture.setFiscalDocument(null);
  await assert.rejects(service.adicionarEtiqueta({ orderId: fixture.orderId }), /nota autorizada ou uma exceção fiscal explícita/);
  assert.equal(fixture.order.shippingLabelAttemptAt, null);
  assert.equal(fixture.calls.length, 0);
});

test("homologation notes cannot ship, but an explicit per-order exemption can", async () => {
  fixture.reset();
  fixture.fiscalDocument!.environment = "homologacao";
  await assert.rejects(service.adicionarEtiqueta({ orderId: fixture.orderId }), /homologação não pode acompanhar um envio real/);
  assert.equal(fixture.order.shippingLabelAttemptAt, null);
  fixture.reset();
  await service.adicionarEtiqueta({ orderId: fixture.orderId });
  const productionPayload = fixture.calls.find(call => call.path === "/api/v0/cart")!.body as any;
  assert.deepEqual(productionPayload.options.invoice, {
    number: "1001",
    key: fixture.fiscalDocument!.accessKey,
  });
  assert.equal(productionPayload.options.non_commercial, false);
  fixture.reset();
  fixture.setFiscalDocument({ ...fixture.fiscalDocument!, status: "exempt", exemptionReason: "Exceção fiscal confirmada pela contabilidade." });
  await service.adicionarEtiqueta({ orderId: fixture.orderId });
  const payload = fixture.calls.find(call => call.path === "/api/v0/cart")!.body as any;
  assert.equal(payload.options.non_commercial, true);
  assert.equal(payload.options.invoice, undefined);
});

test("pay, status, print and cancel use official paths and persist tracking", async () => {
  fixture.reset();
  await service.adicionarEtiqueta({ orderId: fixture.orderId });
  const paid = await service.pagarFinalizarEtiqueta(fixture.orderId);
  assert.equal(paid.status, "released");
  assert.equal(fixture.order.trackingCode, "AA123456789BR");
  await service.pagarFinalizarEtiqueta(fixture.orderId);
  assert.equal(fixture.calls.filter(call => call.path === "/api/v0/checkout").length, 1);
  assert.deepEqual(fixture.calls.find(call => call.path === "/api/v0/checkout")!.body, { orders: ["label-test"] });
  const print = await service.imprimirEtiqueta(fixture.orderId);
  assert.ok(print.url.startsWith("https://sandbox.superfrete.com/"));
  await service.cancelarEtiqueta(fixture.orderId, "Cancelamento de teste");
  assert.equal(fixture.order.shippingLabelStatus, "cancelled");
  assert.deepEqual(fixture.calls.find(call => call.path === "/api/v0/order/cancel")!.body,
    { order: { id: "label-test", description: "Cancelamento de teste" } });
});
