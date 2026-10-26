import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import * as fixture from "./test-support/fiscal-route.ts";

const directory = await mkdtemp(join(tmpdir(), "radio88-fiscal-route-tests-"));
test.after(() => rm(directory, { recursive: true, force: true }));
const helper = new URL("./test-support/fiscal-route.ts", import.meta.url).href;
await build({
  entryPoints: [fileURLToPath(new URL("../routes/fiscal.ts", import.meta.url))],
  outfile: `${directory}/fiscal-route.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "fiscal-route-fixtures",
    setup(builder) {
      builder.onResolve({
        filter: /^express$|^@workspace\/db$|^drizzle-orm$|^\.\.\/middlewares\/auth$|^\.\.\/lib\/fiscal-files$|^\.\.\/lib\/nfeio-provider$|^\.\.\/lib\/fiscal-worker$/,
      }, args => ({ path: args.path, namespace: "fiscal-route-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fiscal-route-fixture" }, () => ({
        contents: `export * from ${JSON.stringify(helper)};`,
        loader: "js",
      }));
      builder.onResolve({ filter: /^file:/ }, args => ({ path: args.path, external: true }));
    },
  }],
});
await import(pathToFileURL(`${directory}/fiscal-route.mjs`).href);

const registrationPath = "/admin/fiscal/documents/:documentId/manual";

function validAccessKey() {
  let sum = 0;
  let weight = 2;
  for (const digit of "1".repeat(43).split("").reverse()) {
    sum += Number(digit) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return `${"1".repeat(43)}${remainder < 2 ? 0 : 11 - remainder}`;
}

function requestNote(headers: Record<string, string> = {}) {
  return fixture.invokeRoute("PUT", registrationPath, {
    params: { documentId: fixture.DOCUMENT_ID },
    headers: {
      "x-test-admin": "authorized",
      "x-test-fiscal": "manage",
      ...headers,
    },
    body: {
      invoiceNumber: "1001",
      series: "1",
      accessKey: validAccessKey(),
      environment: "producao",
      xmlObjectPath: "/objects/fiscal/test-xml",
      danfeObjectPath: "/objects/fiscal/test-pdf",
    },
  });
}

test("authorized staff can register a production note, validate private XML/PDF, and queue its email", async () => {
  fixture.reset();
  const response = await requestNote();
  assert.equal(response.statusCode, 200);
  const saved = response.body as Record<string, unknown>;
  assert.equal(saved.status, "authorized");
  assert.equal(saved.environment, "producao");
  assert.equal(saved.xmlObjectPath, "/objects/fiscal/test-xml");
  assert.equal(saved.danfeObjectPath, "/objects/fiscal/test-pdf");
  assert.deepEqual(fixture.validations, [
    { path: "/objects/fiscal/test-xml", kind: "xml" },
    { path: "/objects/fiscal/test-pdf", kind: "pdf" },
  ]);
  assert.deepEqual(fixture.queuedEmailIds, [fixture.DOCUMENT_ID]);
  assert.equal(fixture.document.status, "authorized");
  assert.equal(fixture.document.environment, "producao");
  assert.equal(fixture.auditEvents.length, 1);
  assert.equal(fixture.auditEvents[0]!.action, "fiscal.manual_note.authorized");
});

test("manual registration rejects anonymous staff and malformed attachments without changing the document", async () => {
  fixture.reset();
  const unauthenticated = await requestNote({ "x-test-admin": "" });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(fixture.document.status, "pending");
  assert.equal(fixture.queuedEmailIds.length, 0);

  const missingPermission = await requestNote({ "x-test-fiscal": "" });
  assert.equal(missingPermission.statusCode, 403);
  assert.equal(fixture.document.status, "pending");
  assert.equal(fixture.queuedEmailIds.length, 0);

  for (const kind of ["xml", "pdf"] as const) {
    fixture.reset();
    fixture.setInvalidAttachment(kind);
    const invalidAttachment = await requestNote();
    assert.equal(invalidAttachment.statusCode, 400);
    assert.equal(fixture.document.status, "pending");
    assert.equal(fixture.document.xmlObjectPath, null);
    assert.equal(fixture.document.danfeObjectPath, null);
    assert.equal(fixture.queuedEmailIds.length, 0);
    assert.equal(fixture.auditEvents.length, 0);
  }
});

test("manual invoice issuance is blocked until every product has a complete fiscal profile", async () => {
  fixture.reset();
  fixture.setMissingProductProfile();
  const response = await requestNote();
  assert.equal(response.statusCode, 409);
  assert.match((response.body as { error: string }).error, /perfis fiscais/);
  assert.equal(fixture.document.status, "pending");
  assert.equal(fixture.validations.length, 0);
  assert.equal(fixture.queuedEmailIds.length, 0);
  assert.equal(fixture.auditEvents.length, 0);
});
