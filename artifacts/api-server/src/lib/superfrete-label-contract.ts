import type { ShippingSettings } from "@workspace/api-zod";
import { SuperfreteError, validatePostalCode, type Volume } from "./superfrete-client.ts";

export type LabelFiscalData = {
  recipientDocument: string;
  recipientEmail?: string;
  invoice?: { number: string; key?: string };
  nonCommercial?: boolean;
};
export type LabelOrderData = {
  orderNumber: string;
  serviceId: string;
  address: Record<string, unknown>;
  volumes: Volume[];
  lines: { productName: string; quantity: number; unitPriceCents: number }[];
};

function invalid(message: string): never {
  throw new SuperfreteError(400, "INVALID_LABEL_DATA", message);
}
function text(value: unknown, field: string, max: number, required = true): string {
  if (value == null && !required) return "";
  if (typeof value !== "string" || value.length > max || (required && !value.trim()) || /[\r\n]/.test(value)) {
    return invalid(`Confira ${field} antes de emitir a etiqueta.`);
  }
  return value.trim();
}
function document(value: string): string {
  if (typeof value !== "string") return invalid("Informe um CPF ou CNPJ para a etiqueta.");
  const digits = value.replace(/\D/g, "");
  if (!/^[\d.\s/-]+$/.test(value) || !/^(\d{11}|\d{14})$/.test(digits) || /^(\d)\1+$/.test(digits)) {
    return invalid("Informe um CPF ou CNPJ válido para a etiqueta.");
  }
  // Validate check digits instead of accepting any 11/14-digit string.
  const cpf = digits.length === 11;
  for (let check = 0; check < 2; check++) {
    const length = (cpf ? 9 : 12) + check;
    const sum = [...digits.slice(0, length)].reduce((acc, digit, index) => {
      const weight = cpf ? length + 1 - index : ((length - 1 - index) % 8) + 2;
      return acc + Number(digit) * weight;
    }, 0);
    const rest = sum % 11;
    const expected = rest < 2 ? 0 : 11 - rest;
    if (Number(digits[length]) !== expected) return invalid("O CPF ou CNPJ informado não passou na validação.");
  }
  return digits;
}
const states = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
function state(value: unknown): string {
  const uf = text(value, "a UF", 2).toUpperCase();
  return states.has(uf) ? uf : invalid("Informe uma UF brasileira válida.");
}
function fullName(value: unknown): string {
  const name = text(value, "o nome completo", 50);
  return name.split(/\s+/).length >= 2 ? name : invalid("Informe nome e sobrenome do remetente/destinatário.");
}
function phone(value: unknown, required: boolean): string | undefined {
  if (!value && !required) return undefined;
  const digits = text(value, "o telefone", 24).replace(/\D/g, "");
  if (!/^\d{11}$/.test(digits)) return invalid("O telefone da etiqueta deve ter DDD e 11 dígitos.");
  return digits;
}
function email(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return invalid("Informe um e-mail válido para a etiqueta.");
  return value;
}

// Canonical contract: POST /api/v0/cart uses `volumes` OBJECT and options.tags.
// No invented packing for multiple volumes: this endpoint documents a single object.
export function buildLabelPayload(order: LabelOrderData, settings: ShippingSettings, fiscal: LabelFiscalData) {
  if (order.volumes.length !== 1 || order.volumes.some(v => Object.values(v).some(n => !Number.isFinite(n) || n <= 0))) {
    return invalid("A cotação não contém um volume único válido. A emissão deste pacote precisa ser revisada pela equipe.");
  }
  if (!/^\d+$/.test(order.serviceId) || !order.lines.length || order.lines.some(line =>
    !Number.isInteger(line.quantity) || line.quantity < 1 || !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0)) {
    return invalid("Confira os produtos e o serviço escolhido.");
  }
  if (fiscal.nonCommercial !== true && !fiscal.invoice) {
    return invalid("Um envio comercial exige os dados da nota fiscal. Não será gerada uma declaração de conteúdo automaticamente.");
  }
  if (fiscal.nonCommercial === true && fiscal.invoice) return invalid("Escolha nota fiscal ou envio não comercial, não ambos.");
  const sender = settings.sender;
  const to = order.address;
  const options = {
    insurance_value: 0, own_hand: false, receipt: false,
    non_commercial: fiscal.nonCommercial === true,
    ...(fiscal.invoice ? {
      invoice: {
        // OpenAPI requires number even when empty; key is optional. Preserve caller's fiscal fields.
        number: text(fiscal.invoice.number, "o número da nota fiscal", 44, false),
        ...(fiscal.invoice.key !== undefined ? { key: text(fiscal.invoice.key, "a chave da nota fiscal", 44, false) } : {}),
      },
    } : {}),
    tags: [{ tag: order.orderNumber }],
  };
  return {
    from: {
      name: fullName(sender.name), document: document(sender.document),
      address: text(sender.street, "a rua de origem", 50),
      number: text(sender.number, "o número de origem", 10, false),
      complement: text(sender.complement, "o complemento de origem", 20, false),
      district: text(sender.neighborhood, "o bairro de origem", 50),
      city: text(sender.city, "a cidade de origem", 50), state_abbr: state(sender.state),
      postal_code: validatePostalCode(settings.originPostalCode),
      ...(phone(sender.phone, false) ? { phone: phone(sender.phone, false) } : {}),
      ...(email(sender.email) ? { email: email(sender.email) } : {}),
    },
    to: {
      name: fullName(to.recipientName), document: document(fiscal.recipientDocument),
      address: text(to.street, "a rua de destino", 50),
      number: text(to.number, "o número de destino", 10, false),
      complement: text(to.complement, "o complemento de destino", 20, false),
      district: text(to.neighborhood, "o bairro de destino", 50),
      city: text(to.city, "a cidade de destino", 50), state_abbr: state(to.state),
      postal_code: validatePostalCode(text(to.postalCode, "o CEP de destino", 10)),
      ...(phone(to.phone, order.serviceId === "33") ? { phone: phone(to.phone, order.serviceId === "33") } : {}),
      ...(email(fiscal.recipientEmail) ? { email: email(fiscal.recipientEmail) } : {}),
    },
    service: Number(order.serviceId),
    products: order.lines.map(line => ({
      name: text(line.productName, "o nome do produto", 160),
      quantity: String(line.quantity), unitary_value: (line.unitPriceCents / 100).toFixed(2),
    })),
    volumes: order.volumes[0],
    options, platform: "Radio88Store",
  };
}
