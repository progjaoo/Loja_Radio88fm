import type { FreteRate, ShippingOption } from "@workspace/api-zod";
export { normalizePostalCode } from "./superfrete-client";

export const pickupAddress: Record<string, unknown> = {
  street: "Rua Moacyr de Paula Lobo",
  number: "104",
  complement: null,
  neighborhood: "Vila Mury",
  city: "Volta Redonda",
  state: "RJ",
  postalCode: "27283-350",
  reference: "Rádio 88 FM",
};

export const pickupOption: ShippingOption = {
  id: "retirada-combinada", label: "Retirada no local — Rádio 88 FM", method: "pickup",
  fee: 0, estimatedDays: 0,
  description: "Rua Moacyr de Paula Lobo, 104 · Vila Mury · Volta Redonda - RJ · CEP 27283-350",
};

export function shippingOptionFromRate(rate: FreteRate): ShippingOption {
  return {
    id: `superfrete-${rate.servicoId}`, label: rate.nome, method: "delivery",
    fee: rate.preco, estimatedDays: rate.prazoDias,
    description: `${rate.transportadora} · Prazo em dias úteis, incluindo manuseio.`,
  };
}
