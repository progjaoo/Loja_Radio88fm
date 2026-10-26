import { SuperfreteError } from "../superfrete-client.ts";

type Row = Record<string, any>;
type Column = { column: string };
type Predicate = (row: Row) => boolean;
export const ordersTable = new Proxy({}, { get: (_target, key) => ({ column: String(key) }) });
export const fiscalDocumentsTable = new Proxy({}, { get: (_target, key) => ({ column: String(key) }) });
export const fiscalRecipientsTable = new Proxy({}, { get: (_target, key) => ({ column: String(key) }) });
export const eq = (column: Column, value: unknown): Predicate => row => row[column.column] === value;
export const isNull = (column: Column): Predicate => row => row[column.column] == null;
export const and = (...predicates: Predicate[]): Predicate => row => predicates.every(predicate => predicate(row));
export let order: Row;
export let fiscalDocument: Row | null;
export let fiscalRecipient: Row | null;
export function setFiscalDocument(value: Row | null) { fiscalDocument = value; }
export let calls: { path: string; method: string; body: unknown }[] = [];
export let creationFails = false;
export function setCreationFailure(value: boolean) { creationFails = value; }
export let providerStatus = "pending";
export const orderId = "00000000-0000-4000-8000-000000000001";
export function reset() {
  calls = []; creationFails = false; providerStatus = "pending";
  let sum = 0;
  let weight = 2;
  for (const digit of "1".repeat(43).split("").reverse()) {
    sum += Number(digit) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const accessKey = `${"1".repeat(43)}${remainder < 2 ? 0 : 11 - remainder}`;
  fiscalDocument = {
    id: "fiscal-document-test", orderId: orderId, status: "authorized", mode: "manual",
    environment: "producao", invoiceNumber: "1001", accessKey, exemptionReason: null,
  };
  fiscalRecipient = {
    id: "fiscal-recipient-test", orderId, taxNumber: "52998224725", legalName: "Pessoa Teste",
    email: "buyer@example.test",
  };
  order = {
    id: orderId, orderNumber: "88-TEST", status: "paid", paymentStatus: "paid",
    shippingMethod: "delivery", shippingServiceId: "1", shippingLabelStatus: null, superfreteLabelId: null,
    shippingLabelAttemptAt: null,
    shippingAddress: { recipientName: "Pessoa Teste", street: "Rua Destino", number: "1", neighborhood: "Centro",
      city: "Rio de Janeiro", state: "RJ", postalCode: "20020050", phone: "21999999999" },
    shippingQuote: { originPostalCode: "01153000", environment: "https://sandbox.superfrete.com",
      volumes: [{ height: 8, width: 16, length: 24, weight: 0.6 }] },
    lines: [{ productName: "Produto", quantity: 2, unitPriceCents: 2500 }],
  };
}
export const getOrder = async () => structuredClone(order);
export const loadShippingSettings = async () => ({
  originPostalCode: "01153000",
  sender: { name: "Loja Teste", document: "11222333000181", street: "Rua Origem", number: "1", complement: "",
    neighborhood: "Centro", city: "São Paulo", state: "SP", phone: "11999999999", email: "sender@example.test" },
});
export const db = {
  select: () => ({
    from: (table: unknown) => ({
      where: (predicate: Predicate) => ({
        limit: async () => {
          const row = table === fiscalDocumentsTable ? fiscalDocument : table === fiscalRecipientsTable ? fiscalRecipient : null;
          return row && predicate(row) ? [structuredClone(row)] : [];
        },
      }),
    }),
  }),
  update: () => ({
    set: (values: Row) => ({
      where: (predicate: Predicate) => {
        const apply = () => {
          if (!predicate(order)) return [];
          Object.assign(order, values);
          return [{ id: order.id }];
        };
        return {
          returning: async () => apply(),
          then: (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(apply).then(resolve, reject),
        };
      },
    }),
  }),
};
export const superfreteClient = () => ({
  request: async (path: string, method: string, body: unknown) => {
    calls.push({ path, method, body: structuredClone(body) });
    if (path === "/api/v0/cart") {
      if (creationFails) throw new SuperfreteError(503, "TIMEOUT", "Timeout de teste.");
      return { id: "label-test", status: "pending", price: 18.61 };
    }
    if (path.startsWith("/api/v0/order/info/")) return {
      id: "label-test", status: providerStatus, tracking: providerStatus === "released" ? "AA123456789BR" : null,
      tags: [{ tag: order.orderNumber }], to: { postal_code: "20020050" }, service_id: 1,
    };
    if (path === "/api/v0/checkout") { providerStatus = "released"; return { success: true }; }
    if (path === "/api/v0/tag/print") return { url: "https://sandbox.superfrete.com/_etiqueta/pdf/test" };
    if (path === "/api/v0/order/cancel") { providerStatus = "cancelled"; return { "label-test": { canceled: true } }; }
    throw new Error("Undocumented endpoint called in test");
  },
});
