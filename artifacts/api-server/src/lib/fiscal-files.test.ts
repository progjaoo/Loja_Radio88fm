import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import * as fixture from "./test-support/fiscal-files.ts";

const directory = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), ".fiscal-files-tests-"));
test.after(() => rm(directory, { recursive: true, force: true }));
const helper = new URL("./test-support/fiscal-files.ts", import.meta.url).href;
const previousPrivateObjectDir = process.env["PRIVATE_OBJECT_DIR"];
test.after(() => {
  if (previousPrivateObjectDir === undefined) delete process.env["PRIVATE_OBJECT_DIR"];
  else process.env["PRIVATE_OBJECT_DIR"] = previousPrivateObjectDir;
});
await build({
  entryPoints: [fileURLToPath(new URL("./fiscal-files.ts", import.meta.url))],
  outfile: `${directory}/fiscal-files.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [{
    name: "private-storage-fixture",
    setup(builder) {
      builder.onResolve({ filter: /^@google-cloud\/storage$/ }, () => ({
        path: "@google-cloud/storage",
        namespace: "storage-fixture",
      }));
      builder.onLoad({ filter: /.*/, namespace: "storage-fixture" }, () => ({
        contents: `export * from ${JSON.stringify(helper)};`,
        loader: "js",
      }));
      builder.onResolve({ filter: /^file:/ }, args => ({ path: args.path, external: true }));
    },
  }],
});
const files = await import(pathToFileURL(`${directory}/fiscal-files.mjs`).href);

const xml = Buffer.from('<?xml version="1.0"?><NFe><infNFe Id="NFe-test"/></NFe>');
function createPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let contents = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(contents, "latin1"));
    contents += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(contents, "latin1");
  contents += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    contents += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  contents += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(contents, "latin1");
}
const pdf = createPdf();

test("valid manual XML and DANFE resolve only inside the configured private bucket", async () => {
  fixture.reset();
  process.env["PRIVATE_OBJECT_DIR"] = "/private-invoice-bucket/private-prefix";
  fixture.setObject("private-invoice-bucket", "private-prefix/fiscal/xml-test", "application/xml", xml);
  fixture.setObject("private-invoice-bucket", "private-prefix/fiscal/pdf-test", "application/pdf", pdf);

  await files.validateFiscalAttachment("/objects/fiscal/xml-test", "xml");
  assert.deepEqual(fixture.lastObject, {
    bucket: "private-invoice-bucket",
    name: "private-prefix/fiscal/xml-test",
  });
  await files.validateFiscalAttachment("/objects/fiscal/pdf-test", "pdf");
  assert.deepEqual(fixture.lastObject, {
    bucket: "private-invoice-bucket",
    name: "private-prefix/fiscal/pdf-test",
  });

  const retrieved = await files.readFiscalFile("/objects/fiscal/pdf-test");
  assert.deepEqual(retrieved.bytes, pdf);
  assert.equal(retrieved.type, "application/pdf");
});

test("manual attachment validation rejects public paths, traversal, mismatched types and invalid bytes", async () => {
  fixture.reset();
  process.env["PRIVATE_OBJECT_DIR"] = "/private-invoice-bucket/private-prefix";
  fixture.setObject("private-invoice-bucket", "private-prefix/fiscal/not-xml", "application/xml", Buffer.from("not XML"));
  fixture.setObject("private-invoice-bucket", "private-prefix/fiscal/not-pdf", "application/pdf", Buffer.from("not PDF"));
  fixture.setObject("private-invoice-bucket", "private-prefix/fiscal/truncated-xml", "application/xml", Buffer.from("<NFe><infNFe>"));
  fixture.setObject("private-invoice-bucket", "private-prefix/fiscal/truncated-pdf", "application/pdf", Buffer.from("%PDF-1.7\n% DANFE truncada\n%%EOF"));
  fixture.setObject("private-invoice-bucket", "private-prefix/fiscal/wrong-type", "text/plain", xml);

  await assert.rejects(files.validateFiscalAttachment("https://public.example.test/invoice.xml", "xml"), /path is invalid/i);
  await assert.rejects(files.validateFiscalAttachment("/objects/fiscal/../public.xml", "xml"), /path is invalid/i);
  await assert.rejects(files.validateFiscalAttachment("/objects/fiscal/not-xml", "xml"), /não corresponde a um XML/i);
  await assert.rejects(files.validateFiscalAttachment("/objects/fiscal/truncated-xml", "xml"), /malformado ou incompleto/i);
  await assert.rejects(files.validateFiscalAttachment("/objects/fiscal/not-pdf", "pdf"), /não corresponde a um PDF/i);
  await assert.rejects(files.validateFiscalAttachment("/objects/fiscal/truncated-pdf", "pdf"), /incompleto ou corrompido/i);
  await assert.rejects(files.validateFiscalAttachment("/objects/fiscal/wrong-type", "xml"), /não foi identificado como XML/i);
});
