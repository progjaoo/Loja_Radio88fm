import { and, eq, isNull } from "drizzle-orm";
import { db, fiscalDocumentsTable, fiscalRecipientsTable, ordersTable, type Order } from "@workspace/db";
import { getOrder } from "./orders";
import { superfreteClient } from "./superfrete";
import { loadShippingSettings } from "./shipping-settings";
import { buildLabelPayload, type LabelFiscalData } from "./superfrete-label-contract";
import { isValidAccessKey, isValidCpfCnpj, normalizeTaxNumber } from "./fiscal-validation";
import { SuperfreteError, type Volume } from "./superfrete-client";

// The admin route layer enforces staff permissions; this service independently
// verifies payment, delivery eligibility, recipient data and fiscal clearance.
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SuperfreteError(503, "INVALID_RESPONSE", "Resposta inválida da SuperFrete. A etiqueta precisa de conferência manual.");
  }
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new SuperfreteError(503, "INVALID_LABEL_ID", "Identificador da etiqueta inválido. Confira no painel da SuperFrete.");
  }
  return value;
}
const validStatuses = new Set(["pending", "released", "posted", "delivered", "cancelled", "canceled"]);
function labelStatus(value: unknown): string {
  if (typeof value !== "string" || !validStatuses.has(value)) {
    throw new SuperfreteError(503, "INVALID_LABEL_STATUS", "A SuperFrete retornou um status de etiqueta não reconhecido.");
  }
  return value === "canceled" ? "cancelled" : value;
}
function environmentMatches(order: Order): void {
  if (!order.shippingQuote || order.shippingQuote.environment !== process.env.SUPERFRETE_BASE_URL) {
    throw new SuperfreteError(409, "ENVIRONMENT_MISMATCH", "A etiqueta e a cotação precisam usar o mesmo ambiente SuperFrete.");
  }
}
async function requireOrder(orderId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) throw new SuperfreteError(400, "INVALID_ORDER_ID", "Pedido inválido.");
  const order = await getOrder(orderId);
  if (!order) throw new SuperfreteError(404, "ORDER_NOT_FOUND", "Pedido não encontrado.");
  return order;
}
async function labelOrder(orderId: string) {
  const order = await requireOrder(orderId);
  environmentMatches(order);
  if (!order.superfreteLabelId) throw new SuperfreteError(409, "LABEL_NOT_CREATED", "Este pedido ainda não tem etiqueta SuperFrete.");
  id(order.superfreteLabelId);
  return order;
}

async function fiscalDataForLabel(orderId: string): Promise<LabelFiscalData> {
  const [document] = await db.select().from(fiscalDocumentsTable)
    .where(eq(fiscalDocumentsTable.orderId, orderId)).limit(1);
  const [recipient] = await db.select().from(fiscalRecipientsTable)
    .where(eq(fiscalRecipientsTable.orderId, orderId)).limit(1);
  if (!document || !recipient) {
    throw new SuperfreteError(409, "FISCAL_CLEARANCE_REQUIRED", "Registre uma nota autorizada ou uma exceção fiscal explícita antes de emitir a etiqueta.");
  }
  const recipientDocument = normalizeTaxNumber(recipient.taxNumber);
  if (!isValidCpfCnpj(recipientDocument)) {
    throw new SuperfreteError(409, "FISCAL_RECIPIENT_INVALID", "Os dados fiscais do destinatário precisam ser revisados antes da etiqueta.");
  }
  if (document.status === "authorized") {
    if (document.environment !== "producao") {
      throw new SuperfreteError(409, "HOMOLOGATION_NOTE_CANNOT_SHIP", "Uma nota de homologação não pode acompanhar um envio real.");
    }
    if (!document.invoiceNumber || !document.accessKey || !isValidAccessKey(document.accessKey)) {
      throw new SuperfreteError(409, "AUTHORIZED_NOTE_INCOMPLETE", "A nota autorizada precisa ter número e chave válidos para a etiqueta.");
    }
    return {
      recipientDocument,
      recipientEmail: recipient.email,
      invoice: { number: document.invoiceNumber, key: document.accessKey! },
    };
  }
  if (document.status === "exempt" && document.exemptionReason?.trim()) {
    return { recipientDocument, recipientEmail: recipient.email, nonCommercial: true };
  }
  throw new SuperfreteError(409, "FISCAL_CLEARANCE_REQUIRED", "Registre uma nota autorizada ou uma exceção fiscal explícita antes de emitir a etiqueta.");
}

export async function adicionarEtiqueta(input: { orderId: string }) {
  const order = await requireOrder(input.orderId);
  if (order.superfreteLabelId) return { id: order.superfreteLabelId, status: order.shippingLabelStatus };
  if (order.shippingLabelAttemptAt) {
    throw new SuperfreteError(409, "LABEL_RECONCILIATION_REQUIRED", "Já houve uma tentativa de emissão. Confira a etiqueta no painel SuperFrete antes de qualquer nova ação.");
  }
  if (order.paymentStatus !== "paid" || ["cancelled", "returned", "shipped", "delivered"].includes(order.status) || order.shippingMethod !== "delivery") {
    throw new SuperfreteError(409, "ORDER_NOT_ELIGIBLE", "Só é possível criar etiqueta para pedido de entrega pago e ainda não enviado.");
  }
  const fiscal = await fiscalDataForLabel(order.id);
  environmentMatches(order);
  const settings = await loadShippingSettings();
  if (settings.originPostalCode !== order.shippingQuote!.originPostalCode) {
    throw new SuperfreteError(409, "ORIGIN_CHANGED", "O CEP de origem mudou após a cotação. Revise o frete antes de emitir.");
  }
  const volumes = order.shippingQuote!.volumes;
  if (!Array.isArray(volumes) || volumes.some(volume => !volume || typeof volume !== "object")) {
    throw new SuperfreteError(409, "MISSING_VOLUME", "Este pedido não tem a embalagem retornada pela cotação.");
  }
  const payload = buildLabelPayload({
    orderNumber: order.orderNumber, serviceId: order.shippingServiceId ?? "",
    address: order.shippingAddress ?? {}, volumes: volumes as Volume[], lines: order.lines,
  }, settings, fiscal);
  const client = superfreteClient(); // Validate configuration before permanently claiming creation.
  // Atomic durable claim: concurrent calls and process restarts cannot create a second label.
  const [claimed] = await db.update(ordersTable).set({
    shippingLabelAttemptAt: new Date(), shippingLabelStatus: "creating", updatedAt: new Date(),
  }).where(and(eq(ordersTable.id, order.id), isNull(ordersTable.superfreteLabelId),
    isNull(ordersTable.shippingLabelAttemptAt), eq(ordersTable.paymentStatus, "paid"),
    eq(ordersTable.status, order.status))).returning({ id: ordersTable.id });
  if (!claimed) {
    const existing = await requireOrder(order.id);
    if (existing.superfreteLabelId) return { id: existing.superfreteLabelId, status: existing.shippingLabelStatus };
    throw new SuperfreteError(409, "LABEL_ALREADY_CLAIMED", "Emissão já iniciada ou pedido alterado. Confira antes de tentar novamente.");
  }
  try {
    const result = record(await client.request("/api/v0/cart", "POST", payload));
    const labelId = id(result.id);
    const status = labelStatus(result.status);
    if (status !== "pending") throw new SuperfreteError(503, "UNEXPECTED_LABEL_STATUS", "Confira o estado da etiqueta no painel SuperFrete.");
    await db.update(ordersTable).set({
      superfreteLabelId: labelId, shippingLabelStatus: status, updatedAt: new Date(),
    }).where(eq(ordersTable.id, order.id));
    return { id: labelId, status, price: typeof result.price === "number" ? result.price : null };
  } catch (error) {
    await db.update(ordersTable).set({ shippingLabelStatus: "reconciliation_required", updatedAt: new Date() })
      .where(and(eq(ordersTable.id, order.id), isNull(ordersTable.superfreteLabelId)));
    throw error; // Never clear the durable claim: even a timeout may have created the label.
  }
}

async function providerInfo(order: Order) {
  const info = record(await superfreteClient().request(`/api/v0/order/info/${id(order.superfreteLabelId)}`, "GET", undefined, true));
  if (id(info.id) !== order.superfreteLabelId) throw new SuperfreteError(503, "LABEL_ID_MISMATCH", "A etiqueta retornada não corresponde ao pedido.");
  return { info, status: labelStatus(info.status) };
}
async function persistInfo(order: Order, info: Record<string, unknown>, status: string) {
  const localStatus = ["payment_requested", "payment_reconciliation_required"].includes(order.shippingLabelStatus ?? "") && status === "pending"
    ? "payment_reconciliation_required" : status;
  const tracking = info.tracking == null ? null :
    typeof info.tracking === "string" && /^[A-Z0-9-]{1,80}$/i.test(info.tracking) ? info.tracking : undefined;
  if (tracking === undefined) throw new SuperfreteError(503, "INVALID_TRACKING", "Código de rastreio inválido retornado pela SuperFrete.");
  await db.update(ordersTable).set({ shippingLabelStatus: localStatus, trackingCode: tracking, updatedAt: new Date() })
    .where(eq(ordersTable.id, order.id));
  return { id: order.superfreteLabelId!, status: localStatus, tracking };
}

export async function consultarStatusRastreio(orderId: string) {
  const order = await labelOrder(orderId);
  const { info, status } = await providerInfo(order);
  return persistInfo(order, info, status);
}

export async function pagarFinalizarEtiqueta(orderId: string) {
  const order = await labelOrder(orderId);
  if (order.paymentStatus !== "paid" || ["cancelled", "returned"].includes(order.status)) {
    throw new SuperfreteError(409, "ORDER_NOT_ELIGIBLE", "O pedido precisa estar pago e ativo para pagar a etiqueta.");
  }
  const { info, status } = await providerInfo(order);
  if (["released", "posted", "delivered"].includes(status)) return persistInfo(order, info, status);
  if (status !== "pending") throw new SuperfreteError(409, "LABEL_NOT_PENDING", "A etiqueta não está aguardando pagamento.");
  if (order.shippingLabelStatus !== "pending") {
    throw new SuperfreteError(409, "PAYMENT_RECONCILIATION_REQUIRED", "Já houve uma tentativa de pagar a etiqueta. Confira o saldo e a etiqueta no painel SuperFrete.");
  }
  const [claimed] = await db.update(ordersTable).set({ shippingLabelStatus: "payment_requested", updatedAt: new Date() })
    .where(and(eq(ordersTable.id, order.id), eq(ordersTable.shippingLabelStatus, "pending"),
      eq(ordersTable.paymentStatus, "paid"), eq(ordersTable.status, order.status))).returning({ id: ordersTable.id });
  if (!claimed) throw new SuperfreteError(409, "PAYMENT_ALREADY_CLAIMED", "O pagamento da etiqueta já foi iniciado ou o pedido mudou.");
  try {
    const result = record(await superfreteClient().request("/api/v0/checkout", "POST", { orders: [order.superfreteLabelId] }));
    if (result.success !== true) throw new SuperfreteError(503, "LABEL_PAYMENT_FAILED", "Não foi possível confirmar o pagamento da etiqueta.");
    // Query documented status instead of assuming a paid API response equals released.
    return await consultarStatusRastreio(orderId);
  } catch (error) {
    await db.update(ordersTable).set({ shippingLabelStatus: "payment_reconciliation_required", updatedAt: new Date() })
      .where(and(eq(ordersTable.id, order.id), eq(ordersTable.shippingLabelStatus, "payment_requested")));
    throw error;
  }
}

export async function imprimirEtiqueta(orderId: string) {
  const order = await labelOrder(orderId);
  const { status } = await providerInfo(order);
  if (!["released", "posted", "delivered"].includes(status)) {
    throw new SuperfreteError(409, "LABEL_NOT_RELEASED", "Pague e libere a etiqueta antes de imprimir.");
  }
  const result = record(await superfreteClient().request("/api/v0/tag/print", "POST", { orders: [order.superfreteLabelId] }));
  if (typeof result.url !== "string") throw new SuperfreteError(503, "INVALID_PRINT_URL", "Link de impressão indisponível.");
  let url: URL;
  try { url = new URL(result.url); } catch { throw new SuperfreteError(503, "INVALID_PRINT_URL", "Link de impressão inválido."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new SuperfreteError(503, "INVALID_PRINT_URL", "Link de impressão inválido.");
  return { url: url.href }; // Do not fetch or log signed URLs.
}

export async function cancelarEtiqueta(orderId: string, reason: string) {
  if (typeof reason !== "string" || !reason.trim() || reason.length > 500) {
    throw new SuperfreteError(400, "INVALID_CANCEL_REASON", "Informe o motivo do cancelamento.");
  }
  const order = await labelOrder(orderId);
  const { info, status } = await providerInfo(order);
  if (status === "cancelled") return persistInfo(order, info, status);
  if (!["pending", "released"].includes(status)) {
    throw new SuperfreteError(409, "LABEL_ALREADY_POSTED", "Só é possível cancelar etiqueta que ainda não foi postada.");
  }
  const result = record(await superfreteClient().request("/api/v0/order/cancel", "POST", {
    order: { id: order.superfreteLabelId, description: reason.trim() },
  }));
  const canceled = record(result[order.superfreteLabelId!]);
  if (canceled.canceled !== true) throw new SuperfreteError(503, "CANCEL_NOT_CONFIRMED", "Confira o cancelamento no painel SuperFrete.");
  await db.update(ordersTable).set({ shippingLabelStatus: "cancelled", updatedAt: new Date() }).where(eq(ordersTable.id, order.id));
  return { id: order.superfreteLabelId!, status: "cancelled" };
}

// Explicit recovery only: attach a known provider label after a lost creation response.
// Never clear attemptAt or create another label. Verify the tag and destination first.
export async function reconciliarEtiqueta(orderId: string, providerLabelId: string) {
  const order = await requireOrder(orderId);
  environmentMatches(order);
  const labelId = id(providerLabelId);
  if (order.superfreteLabelId && order.superfreteLabelId !== labelId) {
    throw new SuperfreteError(409, "LABEL_ALREADY_ATTACHED", "O pedido já tem outra etiqueta.");
  }
  if (!order.shippingLabelAttemptAt) throw new SuperfreteError(409, "NO_LABEL_ATTEMPT", "O pedido não tem uma emissão pendente de reconciliação.");
  const info = record(await superfreteClient().request(`/api/v0/order/info/${labelId}`, "GET", undefined, true));
  const tags = Array.isArray(info.tags) ? info.tags : [];
  const to = record(info.to);
  if (id(info.id) !== labelId || !tags.some(tag => record(tag).tag === order.orderNumber) ||
      to.postal_code !== String(order.shippingAddress?.postalCode ?? "").replace(/\D/g, "") ||
      String(info.service_id) !== order.shippingServiceId) {
    throw new SuperfreteError(409, "LABEL_ORDER_MISMATCH", "A etiqueta não corresponde ao serviço, destinatário e identificação deste pedido.");
  }
  const status = labelStatus(info.status);
  const [attached] = await db.update(ordersTable).set({ superfreteLabelId: labelId, shippingLabelStatus: status, updatedAt: new Date() })
    .where(and(eq(ordersTable.id, order.id), isNull(ordersTable.superfreteLabelId))).returning({ id: ordersTable.id });
  if (!attached && order.superfreteLabelId !== labelId) {
    throw new SuperfreteError(409, "RECONCILIATION_CONFLICT", "Outra etiqueta foi associada simultaneamente. Confira o pedido.");
  }
  return consultarStatusRastreio(orderId);
}
