import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import * as fixture from "./test-support/email-outbox.ts";

const directory = await mkdtemp(join(tmpdir(), "radio88-fiscal-email-tests-"));
test.after(() => rm(directory, { recursive: true, force: true }));
const helper = new URL("./test-support/email-outbox.ts", import.meta.url).href;

async function loadOutboxBundle(filename: string) {
  const bundlePath = `${directory}/${filename}`;
  await build({
    entryPoints: [fileURLToPath(new URL("./email-outbox.ts", import.meta.url))],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins: [{
      name: "outbox-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^@replit\/connectors-sdk$|^@workspace\/db$|^drizzle-orm$|^\.\/logger$|^\.\/fiscal-files$/ },
          args => ({ path: args.path, namespace: "outbox-fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "outbox-fixture" }, () => ({
          contents: `export * from ${JSON.stringify(helper)};`,
          loader: "js",
        }));
        builder.onResolve({ filter: /^file:/ }, args => ({ path: args.path, external: true }));
      },
    }],
  });
  return import(pathToFileURL(bundlePath).href);
}

const outbox = await loadOutboxBundle("email-outbox.mjs");

const liveTestRecipient = process.env["FISCAL_EMAIL_LIVE_TEST_TO"]?.trim();
const liveTestEnabled = Boolean(
  liveTestRecipient &&
  process.env["FISCAL_EMAIL_LIVE_TEST_NONPROD_CONFIRMED"] === "true" &&
  process.env["STORE_EMAIL_FROM"]?.trim(),
);

test("authorized fiscal email sends both private files as attachments without PII links or logs", async () => {
  fixture.reset();
  const previousSender = process.env["STORE_EMAIL_FROM"];
  const previousDeliveryEnabled = process.env["EMAIL_DELIVERY_ENABLED"];
  const previousProvider = process.env["EMAIL_PROVIDER"];
  const previousSetInterval = globalThis.setInterval;
  process.env["STORE_EMAIL_FROM"] = "store@example.test";
  process.env["EMAIL_DELIVERY_ENABLED"] = "true";
  process.env["EMAIL_PROVIDER"] = "replit";
  globalThis.setInterval = (() => ({ unref() {} })) as unknown as typeof setInterval;

  try {
    outbox.startEmailOutboxWorker();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        fixture.waitForDelivery(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Timed out waiting for test email delivery.")), 2_000);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    await fixture.waitForSent();
    assert.equal(fixture.getEmailStatus(), "sent");

    assert.deepEqual(fixture.readPaths.sort(), [
      "/objects/fiscal/private-pdf",
      "/objects/fiscal/private-xml",
    ]);
    assert.equal(fixture.delivered.length, 1);
    const request = fixture.delivered[0]!;
    assert.equal(request.service, "resend");
    assert.equal(request.path, "/emails");
    assert.equal(request.options.headers["Idempotency-Key"], "email-event-test");

    const message = request.options.body;
    assert.equal(message.to, "customer@example.test");
    assert.match(message.text, /DANFE e o XML seguem anexos/i);
    assert.equal(message.attachments.length, 2);
    assert.deepEqual(
      message.attachments.map((attachment: Record<string, string>) => ({
        filename: attachment.filename,
        content_type: attachment.content_type,
      })),
      [
        { filename: "DANFE-1001.pdf", content_type: "application/pdf" },
        { filename: "NFe-1001.xml", content_type: "application/xml" },
      ],
    );
    const xmlAttachment = Buffer.from(message.attachments[1].content, "base64").toString("utf8");
    const pdfAttachment = Buffer.from(message.attachments[0].content, "base64").toString("utf8");
    assert.match(xmlAttachment, /CPF-CNPJ-TEST-MARKER/);
    assert.match(pdfAttachment, /DANFE-TEST-MARKER/);

    const publicMessage = JSON.stringify({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    assert.doesNotMatch(publicMessage, /CPF-CNPJ-TEST-MARKER|ADDRESS-TEST-MARKER/);
    assert.doesNotMatch(publicMessage, /https?:\/\/|\/objects\/fiscal\//i);
    assert.equal(fixture.logs.length, 0);
  } finally {
    globalThis.setInterval = previousSetInterval;
    if (previousSender === undefined) delete process.env["STORE_EMAIL_FROM"];
    else process.env["STORE_EMAIL_FROM"] = previousSender;
    if (previousDeliveryEnabled === undefined) delete process.env["EMAIL_DELIVERY_ENABLED"];
    else process.env["EMAIL_DELIVERY_ENABLED"] = previousDeliveryEnabled;
    if (previousProvider === undefined) delete process.env["EMAIL_PROVIDER"];
    else process.env["EMAIL_PROVIDER"] = previousProvider;
  }
});

test("direct Resend delivery sends stable idempotency and stores its provider ID", async () => {
  fixture.reset();
  const previousSender = process.env["STORE_EMAIL_FROM"];
  const previousApiKey = process.env["RESEND_API_KEY"];
  const previousDeliveryEnabled = process.env["EMAIL_DELIVERY_ENABLED"];
  const previousProvider = process.env["EMAIL_PROVIDER"];
  const previousFetch = globalThis.fetch;
  const previousSetInterval = globalThis.setInterval;
  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  process.env["STORE_EMAIL_FROM"] = "store@example.test";
  process.env["RESEND_API_KEY"] = "re_test_key";
  process.env["EMAIL_DELIVERY_ENABLED"] = "true";
  process.env["EMAIL_PROVIDER"] = "resend";
  globalThis.setInterval = (() => ({ unref() {} })) as unknown as typeof setInterval;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ id: "re_test_message" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    outbox.startEmailOutboxWorker();
    await fixture.waitForSent();
    assert.equal(fixture.getEmailStatus(), "sent");
    assert.equal(fixture.getProviderMessageId(), "re_test_message");
    assert.equal(requestUrl, "https://api.resend.com/emails");
    assert.equal(new Headers(requestInit?.headers).get("Authorization"), "Bearer re_test_key");
    assert.equal(new Headers(requestInit?.headers).get("Idempotency-Key"), "email-event-test");
    const body = JSON.parse(String(requestInit?.body)) as {
      to: string;
      attachments: { filename: string }[];
    };
    assert.equal(body.to, "customer@example.test");
    assert.deepEqual(body.attachments.map(({ filename }) => filename), ["DANFE-1001.pdf", "NFe-1001.xml"]);
    assert.equal(fixture.delivered.length, 0, "Direct Resend delivery must not call the Replit connector.");
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.setInterval = previousSetInterval;
    if (previousSender === undefined) delete process.env["STORE_EMAIL_FROM"];
    else process.env["STORE_EMAIL_FROM"] = previousSender;
    if (previousApiKey === undefined) delete process.env["RESEND_API_KEY"];
    else process.env["RESEND_API_KEY"] = previousApiKey;
    if (previousDeliveryEnabled === undefined) delete process.env["EMAIL_DELIVERY_ENABLED"];
    else process.env["EMAIL_DELIVERY_ENABLED"] = previousDeliveryEnabled;
    if (previousProvider === undefined) delete process.env["EMAIL_PROVIDER"];
    else process.env["EMAIL_PROVIDER"] = previousProvider;
  }
});

test("direct Resend marks permanent provider errors failed without storing the response body", async () => {
  fixture.reset();
  const previousSender = process.env["STORE_EMAIL_FROM"];
  const previousApiKey = process.env["RESEND_API_KEY"];
  const previousDeliveryEnabled = process.env["EMAIL_DELIVERY_ENABLED"];
  const previousProvider = process.env["EMAIL_PROVIDER"];
  const previousFetch = globalThis.fetch;
  const previousSetInterval = globalThis.setInterval;

  process.env["STORE_EMAIL_FROM"] = "store@example.test";
  process.env["RESEND_API_KEY"] = "re_test_key";
  process.env["EMAIL_DELIVERY_ENABLED"] = "true";
  process.env["EMAIL_PROVIDER"] = "resend";
  globalThis.setInterval = (() => ({ unref() {} })) as unknown as typeof setInterval;
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: "private provider detail" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

  try {
    outbox.startEmailOutboxWorker();
    await fixture.waitForSettled();
    assert.equal(fixture.getEmailStatus(), "failed");
    assert.equal(fixture.getLastError(), "Email provider returned HTTP 401.");
    assert.doesNotMatch(JSON.stringify(fixture.logs), /private provider detail|re_test_key/);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.setInterval = previousSetInterval;
    if (previousSender === undefined) delete process.env["STORE_EMAIL_FROM"];
    else process.env["STORE_EMAIL_FROM"] = previousSender;
    if (previousApiKey === undefined) delete process.env["RESEND_API_KEY"];
    else process.env["RESEND_API_KEY"] = previousApiKey;
    if (previousDeliveryEnabled === undefined) delete process.env["EMAIL_DELIVERY_ENABLED"];
    else process.env["EMAIL_DELIVERY_ENABLED"] = previousDeliveryEnabled;
    if (previousProvider === undefined) delete process.env["EMAIL_PROVIDER"];
    else process.env["EMAIL_PROVIDER"] = previousProvider;
  }
});

test("explicit live test delivers synthetic DANFE and XML through Resend without exposing fiscal data", {
  skip: !liveTestEnabled,
}, async () => {
  assert.ok(liveTestRecipient);
  assert.ok(process.env["STORE_EMAIL_FROM"]?.trim());

  const liveOutbox = await loadOutboxBundle("email-outbox-live.mjs");
  const { ReplitConnectors } = await import("@replit/connectors-sdk");
  const resend = new ReplitConnectors();
  const eventId = `fiscal-email-live-${randomUUID()}`;
  fixture.reset({ recipient: liveTestRecipient, eventId });

  let providerEmailId: string | undefined;
  fixture.setLiveProxy(async (service, path, options) => {
    assert.equal(service, "resend");
    assert.equal(path, "/emails");
    assert.equal(options.method, "POST");

    const message = options.body as {
      to: string;
      text: string;
      html: string;
      attachments: { filename: string; content: string; content_type: string }[];
    };
    assert.equal(message.to, liveTestRecipient, "Live test must never address an order/customer email.");
    assert.deepEqual(
      message.attachments.map(({ filename, content_type }) => ({ filename, content_type })),
      [
        { filename: "DANFE-1001.pdf", content_type: "application/pdf" },
        { filename: "NFe-1001.xml", content_type: "application/xml" },
      ],
    );
    const publicContent = `${message.text}\n${message.html}`;
    assert.doesNotMatch(publicContent, /CPF-CNPJ-TEST-MARKER|ADDRESS-TEST-MARKER/);
    assert.doesNotMatch(publicContent, /https?:\/\/|\/objects\/fiscal\//i);

    const response = await resend.proxy(service, path, options);
    if (response.ok) {
      const result = await response.clone().json() as { id?: unknown };
      providerEmailId = typeof result.id === "string" ? result.id : undefined;
    }
    return response;
  });

  const previousSetInterval = globalThis.setInterval;
  const previousDeliveryEnabled = process.env["EMAIL_DELIVERY_ENABLED"];
  process.env["EMAIL_DELIVERY_ENABLED"] = "true";
  globalThis.setInterval = (() => ({ unref() {} })) as unknown as typeof setInterval;
  try {
    liveOutbox.startEmailOutboxWorker();
    let sendTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        fixture.waitForSettled(),
        new Promise((_, reject) => {
          sendTimeout = setTimeout(() => reject(new Error("Timed out waiting for the live email send.")), 30_000);
        }),
      ]);
    } finally {
      if (sendTimeout) clearTimeout(sendTimeout);
    }
    assert.equal(fixture.getEmailStatus(), "sent");
    assert.ok(providerEmailId, "Resend must return a message ID.");
    assert.equal(fixture.delivered.length, 1);
    assert.equal(fixture.delivered[0]!.options.headers["Idempotency-Key"], eventId);
    assert.deepEqual(fixture.readPaths.sort(), [
      "/objects/fiscal/private-pdf",
      "/objects/fiscal/private-xml",
    ]);
    assert.equal(fixture.logs.length, 0);

    const request = fixture.delivered[0]!;
    const message = request.options.body;
    const pdf = Buffer.from(message.attachments[0].content, "base64");
    const pdfContent = pdf.toString("latin1");
    assert.ok(pdfContent.startsWith("%PDF-1.4"));
    assert.match(pdfContent, /DANFE-TEST-MARKER/);
    assert.match(pdfContent, /ITEM SINTETICO/);
    try {
      const readableText = execFileSync("pdftotext", ["-", "-"], { input: pdf, encoding: "utf8" });
      assert.match(readableText, /DANFE-TEST-MARKER/);
      assert.match(readableText, /ITEM SINTETICO/);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const xml = Buffer.from(message.attachments[1].content, "base64").toString("utf8");
    assert.match(xml, /<CPF>CPF-CNPJ-TEST-MARKER<\/CPF>/);
    assert.match(xml, /<xLgr>ADDRESS-TEST-MARKER<\/xLgr>/);

    let lastEvent: string | undefined;
    for (let attempt = 0; attempt < 18; attempt++) {
      const response = await resend.proxy("resend", `/emails/${encodeURIComponent(providerEmailId)}`, { method: "GET" });
      assert.equal(response.ok, true, "Resend must allow the test to check delivery status.");
      const details = await response.json() as { last_event?: unknown };
      lastEvent = typeof details.last_event === "string" ? details.last_event : undefined;
      if (lastEvent === "delivered" || lastEvent === "bounced" || lastEvent === "complained") break;
      await new Promise(resolve => setTimeout(resolve, 3_000));
    }
    assert.equal(lastEvent, "delivered", "The recipient mail server must confirm delivery.");

    const attachmentsResponse = await resend.proxy(
      "resend",
      `/emails/${encodeURIComponent(providerEmailId)}/attachments`,
      { method: "GET" },
    );
    assert.equal(attachmentsResponse.ok, true, "Resend must expose attachment metadata for the delivered message.");
    const attachmentResult = await attachmentsResponse.json() as {
      data?: { filename?: string }[];
    };
    assert.deepEqual(
      attachmentResult.data?.map(attachment => attachment.filename).sort(),
      ["DANFE-1001.pdf", "NFe-1001.xml"],
    );
  } finally {
    globalThis.setInterval = previousSetInterval;
    if (previousDeliveryEnabled === undefined) delete process.env["EMAIL_DELIVERY_ENABLED"];
    else process.env["EMAIL_DELIVERY_ENABLED"] = previousDeliveryEnabled;
  }
});
