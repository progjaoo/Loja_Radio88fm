import type { FreteRate, ShippingSettings } from "@workspace/api-zod";

export class SuperfreteError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function normalizePostalCode(value: string): string {
  return value.replace(/\D/g, "");
}

export function validatePostalCode(value: string): string {
  const cep = normalizePostalCode(value);
  if (!/^\d{8}$/.test(cep) || !/^[\d.\s-]+$/.test(value) || cep === "00000000") {
    throw new SuperfreteError(400, "INVALID_POSTAL_CODE", "Informe um CEP brasileiro válido com oito números.");
  }
  return cep;
}

export type Volume = { height: number; width: number; length: number; weight: number };
export type ShippingItem = Volume & { variantId: string; quantity: number; unitPriceCents: number; name: string };
export type QuotedService = {
  rate: FreteRate;
  basePrice: number;
  volumes: Volume[];
};
export type QuoteResult = { rates: FreteRate[]; services: Record<string, QuotedService> };
type ClientConfig = { token: string; baseUrl: string; contactEmail: string };
type SafeLog = (details: { path: string; status?: number; attempt: number; code: string }) => void;

export function validateClientConfig(config: ClientConfig): ClientConfig {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  if (!config.token || !["https://sandbox.superfrete.com", "https://api.superfrete.com"].includes(baseUrl) ||
      !/^[^\s@()]+@[^\s@()]+\.[^\s@()]+$/.test(config.contactEmail) ||
      /[\r\n]/.test(config.token + config.contactEmail)) {
    throw new SuperfreteError(503, "NOT_CONFIGURED", "A entrega está temporariamente indisponível. Você ainda pode escolher retirada.");
  }
  return { ...config, baseUrl };
}

export class SuperfreteClient {
  private config: ClientConfig;
  private fetcher: typeof fetch;
  private log: SafeLog;
  constructor(config: ClientConfig, fetcher: typeof fetch = fetch, log: SafeLog = () => {}) {
    this.config = validateClientConfig(config);
    this.fetcher = fetcher;
    this.log = log;
  }

  // Only safe reads/calculations may retry. Label creation/payment never retry:
  // a lost response does not imply the provider did not perform the operation.
  async request(path: string, method: "GET" | "POST", body?: unknown, retry = false): Promise<unknown> {
    for (let attempt = 0; attempt <= Number(retry); attempt++) {
      try {
        const response = await this.fetcher(this.config.baseUrl + path, {
          method,
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": `Radio88Store/1.0 (${this.config.contactEmail})`,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          this.log({ path: path.split("/").slice(0, 5).join("/"), status: response.status, attempt, code: "PROVIDER_HTTP_ERROR" });
          // Do not log headers, bodies, postal codes or recipient data.
          if (response.status >= 500 && attempt < Number(retry)) continue;
          if (response.status === 401 || response.status === 403) {
            throw new SuperfreteError(503, "PROVIDER_AUTH", "A entrega está temporariamente indisponível. A equipe precisa verificar a integração.");
          }
          if (response.status === 429) {
            throw new SuperfreteError(429, "PROVIDER_RATE_LIMIT", "Muitas consultas de frete. Aguarde um pouco e tente novamente.");
          }
          if (response.status === 400 || response.status === 422) {
            throw new SuperfreteError(400, "PROVIDER_VALIDATION", "Não foi possível atender este CEP ou pacote. Confira os dados de envio.");
          }
          throw new SuperfreteError(503, "PROVIDER_HTTP_ERROR", "Não foi possível consultar a transportadora agora. Tente novamente em instantes.");
        }
        return await response.json();
      } catch (error) {
        if (error instanceof SuperfreteError) throw error;
        const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
        this.log({ path: path.split("/").slice(0, 5).join("/"), attempt, code: timeout ? "TIMEOUT" : "NETWORK_OR_RESPONSE_ERROR" });
        if (attempt < Number(retry)) continue;
        throw new SuperfreteError(503, timeout ? "TIMEOUT" : "NETWORK_OR_RESPONSE_ERROR",
          timeout ? "A consulta de frete demorou demais. Tente novamente." : "O serviço de frete está indisponível. Tente novamente.");
      }
    }
    throw new SuperfreteError(503, "UNAVAILABLE", "Frete indisponível.");
  }

  async cotarFrete(input: { cepDestino: string; itens: ShippingItem[]; settings: ShippingSettings }): Promise<QuoteResult> {
    const to = validatePostalCode(input.cepDestino);
    let from: string;
    try { from = validatePostalCode(input.settings.originPostalCode); } catch {
      throw new SuperfreteError(503, "INVALID_ORIGIN", "A entrega está indisponível até a equipe configurar o CEP de origem.");
    }
    if (!input.itens.length || input.itens.length > 100 || input.itens.some(item =>
      !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20 ||
      !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0 ||
      [item.weight, item.height, item.width, item.length].some(value => !Number.isFinite(value) || value <= 0))) {
      throw new SuperfreteError(400, "INVALID_ITEMS", "O carrinho contém dados de envio inválidos.");
    }
    const raw = await this.request("/api/v0/calculator", "POST", {
      from: { postal_code: from },
      to: { postal_code: to },
      services: "1,2,17,3,31",
      options: { own_hand: false, receipt: false, insurance_value: 0, use_insurance_value: false },
      // SuperFrete computes the ideal box; its returned packages are kept for label issuance.
      products: input.itens.map(({ quantity, weight, height, width, length }) => ({ quantity, weight, height, width, length })),
    }, true);
    return normalizeQuoteResponse(raw, input.itens.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0), input.settings);
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function number(value: unknown): number {
  return typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN;
}
export function normalizeQuoteResponse(raw: unknown, subtotalCents: number, settings: ShippingSettings): QuoteResult {
  if (!Array.isArray(raw)) throw new SuperfreteError(503, "INVALID_RESPONSE", "A transportadora retornou uma resposta inválida. Tente novamente.");
  const result: QuoteResult = { rates: [], services: {} };
  for (const value of raw) {
    const row = object(value);
    if (!row || !/^\d+$/.test(String(row.id))) continue;
    const servicoId = String(row.id);
    const company = object(row.company);
    const name = typeof row.name === "string" ? row.name.slice(0, 100) : `Serviço ${servicoId}`;
    const carrier = typeof company?.name === "string" ? company.name.slice(0, 100) : "Transportadora";
    const price = number(row.price);
    const days = number(row.delivery_time);
    const volumes: Volume[] = Array.isArray(row.packages) ? row.packages.map(packageValue => {
      const pack = object(packageValue);
      const dims = object(pack?.dimensions);
      return { height: number(dims?.height), width: number(dims?.width), length: number(dims?.length), weight: number(pack?.weight) };
    }) : [];
    const unavailable = Boolean(row.has_error || row.error) || !Number.isFinite(price) || price < 0 || !Number.isSafeInteger(Math.round(price * 100)) ||
      !Number.isInteger(days) || days < 0 || !volumes.length ||
      volumes.some(volume => Object.values(volume).some(n => !Number.isFinite(n) || n <= 0));
    const free = settings.freeShippingAbove !== null && subtotalCents >= Math.round(settings.freeShippingAbove * 100);
    const feeCents = Math.round(price * (1 + settings.marginPercent / 100) * 100) + Math.round(settings.marginFixed * 100);
    const rate: FreteRate = {
      servicoId, nome: name, transportadora: carrier,
      preco: unavailable || free ? 0 : feeCents / 100,
      prazoDias: unavailable ? 0 : days + settings.handlingDays,
      ...(unavailable ? { erro: "Serviço indisponível para este CEP ou pacote." } : {}),
    };
    result.rates.push(rate);
    if (!unavailable) result.services[servicoId] = { rate, basePrice: price, volumes };
  }
  if (raw.length && !result.rates.length) throw new SuperfreteError(503, "INVALID_RESPONSE", "Não foi possível interpretar as opções de frete.");
  return result;
}

export class ShippingQuoteCache {
  private entries = new Map<string, { expires: number; value: QuoteResult }>();
  get(key: string, now = Date.now()): QuoteResult | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expires <= now) { this.entries.delete(key); return undefined; }
    return structuredClone(entry.value);
  }
  set(key: string, value: QuoteResult, now = Date.now()): void {
    if (this.entries.size >= 500) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value: structuredClone(value), expires: now + 10 * 60 * 1000 });
  }
  clear(): void { this.entries.clear(); }
}
