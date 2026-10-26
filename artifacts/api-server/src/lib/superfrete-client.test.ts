import assert from "node:assert/strict";
import test from "node:test";
import type { ShippingSettings } from "@workspace/api-zod";
import { ShippingQuoteCache, SuperfreteClient, SuperfreteError, normalizeQuoteResponse, validatePostalCode } from "./superfrete-client.ts";
import { buildLabelPayload } from "./superfrete-label-contract.ts";

const settings: ShippingSettings = {
  originPostalCode: "01153000", handlingDays: 2, marginPercent: 10, marginFixed: 1, freeShippingAbove: null,
  defaultWeightKg: 0.3, defaultHeightCm: 4, defaultWidthCm: 16, defaultLengthCm: 24,
  sender: { name: "Loja Teste", document: "11222333000181", street: "Rua Teste", number: "1", complement: "",
    neighborhood: "Centro", city: "São Paulo", state: "SP", phone: "11999999999", email: "sender@example.test" },
};
const item = { variantId: "test", name: "Produto", quantity: 2, unitPriceCents: 2500, weight: 0.3, height: 4, width: 16, length: 24 };
const raw = [{
  id: 1, name: "PAC", price: "18.61", delivery_time: 5, company: { name: "Correios" }, has_error: false,
  packages: [{ dimensions: { height: "8", width: "16", length: "24" }, weight: "0.6" }],
}];
const config = { token: "test-only-token", baseUrl: "https://sandbox.superfrete.com/", contactEmail: "tech@example.test" };
function client(handler: (url: string, options: RequestInit) => Promise<Response>) {
  return new SuperfreteClient(config, ((url, options) => handler(String(url), options!)) as typeof fetch);
}

test("valid CEP is sanitized; invalid CEPs are rejected", () => {
  assert.equal(validatePostalCode("20020-050"), "20020050");
  for (const cep of ["123", "123456789", "abcdefgh", "00000000", "abc20020050"]) {
    assert.throws(() => validatePostalCode(cep), error => error instanceof SuperfreteError && error.status === 400);
  }
});

test("valid quote uses official calculator, required headers, products and quantities", async () => {
  const sf = client(async (url, options) => {
    assert.equal(url, "https://sandbox.superfrete.com/api/v0/calculator");
    assert.equal(options.method, "POST");
    assert.equal((options.headers as Record<string, string>).Authorization, "Bearer test-only-token");
    assert.equal((options.headers as Record<string, string>).Accept, "application/json");
    assert.match((options.headers as Record<string, string>)["User-Agent"], /Radio88Store\/1.0 \(tech@example.test\)/);
    const body = JSON.parse(options.body as string);
    assert.deepEqual(body.from, { postal_code: "01153000" });
    assert.deepEqual(body.to, { postal_code: "20020050" });
    assert.deepEqual(body.products, [{ quantity: 2, weight: 0.3, height: 4, width: 16, length: 24 }]);
    assert.equal(body.services, "1,2,17,3,31");
    assert.equal(body.package, undefined);
    assert.ok(options.signal);
    return Response.json(raw);
  });
  const result = await sf.cotarFrete({ cepDestino: "20020-050", itens: [item], settings });
  assert.deepEqual(result.rates, [{ servicoId: "1", nome: "PAC", transportadora: "Correios", preco: 21.47, prazoDias: 7 }]);
  assert.deepEqual(result.services["1"].volumes, [{ height: 8, width: 16, length: 24, weight: 0.6 }]);
});

test("invalid CEP or quantities cause no provider calls", async () => {
  let calls = 0;
  const sf = client(async () => { calls++; return Response.json(raw); });
  await assert.rejects(sf.cotarFrete({ cepDestino: "123", itens: [item], settings }), /CEP/);
  await assert.rejects(sf.cotarFrete({ cepDestino: "20020050", itens: [{ ...item, quantity: -1 }], settings }), /carrinho/);
  assert.equal(calls, 0);
});

test("unavailable service has an explicit error, never a purchasable zero price", () => {
  const result = normalizeQuoteResponse([{ id: 17, name: "Mini Envios", has_error: true, error: "Provider details" }], 5000, settings);
  assert.ok(result.rates[0].erro);
  assert.deepEqual(result.services, {});
  assert.ok(!JSON.stringify(result.rates).includes("Provider details"));
});

test("empty provider list means no available services", () => {
  assert.deepEqual(normalizeQuoteResponse([], 5000, settings), { rates: [], services: {} });
});

test("malformed price/deadline/packaging never silently becomes a free rate", () => {
  for (const changes of [{ price: null }, { delivery_time: "invalid" }, { packages: [] }]) {
    const result = normalizeQuoteResponse([{ ...raw[0], ...changes }], 5000, settings);
    assert.ok(result.rates[0].erro);
    assert.deepEqual(result.services, {});
  }
  assert.throws(() => normalizeQuoteResponse({ rates: raw }, 5000, settings), /resposta inválida/);
});

test("free shipping threshold includes cents boundary and retains official volumes/deadline", () => {
  const freeSettings = { ...settings, freeShippingAbove: 50 };
  assert.equal(normalizeQuoteResponse(raw, 4999, freeSettings).rates[0].preco, 21.47);
  const result = normalizeQuoteResponse(raw, 5000, freeSettings);
  assert.equal(result.rates[0].preco, 0);
  assert.equal(result.services["1"].basePrice, 18.61);
  assert.equal(result.rates[0].prazoDias, 7);
});

test("API failure retries once then returns friendly error without provider payload", async () => {
  let calls = 0;
  const sf = client(async () => { calls++; return Response.json({ error: "internal provider details" }, { status: 500 }); });
  await assert.rejects(sf.cotarFrete({ cepDestino: "20020050", itens: [item], settings }),
    error => error instanceof SuperfreteError && error.status === 503 && !error.message.includes("internal"));
  assert.equal(calls, 2);
});

test("network timeout retries exactly once", async () => {
  let calls = 0;
  const sf = client(async () => { calls++; throw new DOMException("timeout", "TimeoutError"); });
  await assert.rejects(sf.cotarFrete({ cepDestino: "20020050", itens: [item], settings }),
    error => error instanceof SuperfreteError && error.code === "TIMEOUT");
  assert.equal(calls, 2);
});

test("401/403 and 429 are friendly and do not retry", async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const sf = client(async () => { calls++; return Response.json({}, { status }); });
    await assert.rejects(sf.cotarFrete({ cepDestino: "20020050", itens: [item], settings }),
      error => error instanceof SuperfreteError && error.status === (status === 429 ? 429 : 503));
    assert.equal(calls, 1);
  }
});

test("unsafe environments or missing credentials fail before sending token", () => {
  for (const change of [{ baseUrl: "http://localhost:9999" }, { baseUrl: "https://attacker.test" }, { token: "" }]) {
    assert.throws(() => new SuperfreteClient({ ...config, ...change }), /indisponível/);
  }
});

test("cache expires after ten minutes, isolates combinations and clones data", () => {
  const cache = new ShippingQuoteCache();
  const quote = normalizeQuoteResponse(raw, 5000, settings);
  cache.set("cep-items-a", quote, 100);
  assert.equal(cache.get("cep-items-b", 200), undefined);
  const fromCache = cache.get("cep-items-a", 200)!;
  fromCache.rates[0].preco = 999;
  assert.equal(cache.get("cep-items-a", 200)!.rates[0].preco, 21.47);
  assert.equal(cache.get("cep-items-a", 600100), undefined);
  cache.set("cep-items-a", quote);
  cache.clear();
  assert.equal(cache.get("cep-items-a"), undefined);
});

test("label creation/payment requests never retry after a lost response", async () => {
  let calls = 0;
  const sf = client(async () => { calls++; throw new DOMException("timeout", "TimeoutError"); });
  await assert.rejects(sf.request("/api/v0/cart", "POST", {}));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(sf.request("/api/v0/checkout", "POST", { orders: ["test"] }));
  assert.equal(calls, 1);
});

const order = {
  orderNumber: "88-TEST", serviceId: "1",
  address: { recipientName: "Pessoa Teste", street: "Rua Destino", number: "12", complement: null, neighborhood: "Centro",
    city: "Rio de Janeiro", state: "RJ", postalCode: "20020-050", phone: "21999999999" },
  volumes: [{ weight: 0.6, height: 8, width: 16, length: 24 }],
  lines: [{ productName: "Produto", quantity: 2, unitPriceCents: 2500 }],
};

test("label follows OpenAPI volumes object, invoice fields and options.tags", () => {
  const payload = buildLabelPayload(order, settings, {
    recipientDocument: "529.982.247-25", invoice: { number: "", key: "1".repeat(44) }, recipientEmail: "buyer@example.test",
  });
  assert.deepEqual(payload.volumes, order.volumes[0]);
  assert.equal("volume" in payload, false);
  assert.equal(payload.to.document, "52998224725");
  assert.equal(payload.to.postal_code, "20020050");
  assert.deepEqual(payload.options.invoice, { number: "", key: "1".repeat(44) });
  assert.deepEqual(payload.options.tags, [{ tag: "88-TEST" }]);
  assert.equal(payload.options.non_commercial, false);
});

test("commercial label requires explicit invoice, never assumes non-commercial declaration", () => {
  assert.throws(() => buildLabelPayload(order, settings, { recipientDocument: "52998224725" }), /nota fiscal/);
  const payload = buildLabelPayload(order, settings, { recipientDocument: "52998224725", nonCommercial: true });
  assert.equal(payload.options.non_commercial, true);
});

test("label refuses invalid fiscal data and unsupported multiple volumes", () => {
  assert.throws(() => buildLabelPayload(order, settings, { recipientDocument: "11111111111", nonCommercial: true }), /CPF/);
  assert.throws(() => buildLabelPayload({ ...order, volumes: [order.volumes[0], order.volumes[0]] },
    settings, { recipientDocument: "52998224725", nonCommercial: true }), /volume único/);
  assert.throws(() => buildLabelPayload({ ...order, address: { ...order.address, state: "ZZ" } },
    settings, { recipientDocument: "52998224725", nonCommercial: true }), /UF/);
});
