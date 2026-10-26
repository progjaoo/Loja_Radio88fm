import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import {
  db,
  orderLinesTable,
  ordersTable,
  type Order,
  type OrderLine,
} from "@workspace/db";
import { centsToReais } from "./currency";
import { addressToText } from "./serializers";

export type OrderAggregate = Order & { lines: OrderLine[] };

export async function getOrder(id: string, userId?: string): Promise<OrderAggregate | undefined> {
  const conditions: SQL[] = [eq(ordersTable.id, id)];
  if (userId) conditions.push(eq(ordersTable.userId, userId));
  const [order] = await db.select().from(ordersTable).where(and(...conditions)).limit(1);
  if (!order) return undefined;
  const lines = await db.select().from(orderLinesTable).where(eq(orderLinesTable.orderId, id));
  return { ...order, lines };
}

export async function getOrders(userId?: string, status?: Order["status"]): Promise<OrderAggregate[]> {
  const conditions: SQL[] = [];
  if (userId) conditions.push(eq(ordersTable.userId, userId));
  if (status) conditions.push(eq(ordersTable.status, status));
  const query = db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt));
  const orders = conditions.length ? await query.where(and(...conditions)) : await query;
  if (!orders.length) return [];
  const ids = orders.map((order) => order.id);
  const lines = await db.select().from(orderLinesTable).where(inArray(orderLinesTable.orderId, ids));
  const linesByOrder = new Map<string, OrderLine[]>();
  for (const line of lines) {
    const existing = linesByOrder.get(line.orderId) ?? [];
    existing.push(line);
    linesByOrder.set(line.orderId, existing);
  }
  return orders.map((order) => ({ ...order, lines: linesByOrder.get(order.id) ?? [] }));
}

export function serializeOrder(order: OrderAggregate) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    shippingMethod: order.shippingMethod,
    shippingLabel: order.shippingLabel,
    shippingServiceId: order.shippingServiceId,
    shippingCarrier: order.shippingCarrier,
    shippingDays: order.shippingDays,
    superfreteLabelId: order.superfreteLabelId,
    shippingLabelStatus: order.shippingLabelStatus,
    shippingAddress: addressToText(order.shippingAddress),
    trackingCode: order.trackingCode,
    subtotal: centsToReais(order.subtotalCents),
    shippingFee: centsToReais(order.shippingFeeCents),
    total: centsToReais(order.totalCents),
    paymentInstructions: order.paymentInstructions,
    createdAt: order.createdAt.toISOString(),
    lines: order.lines.map((line) => ({
      productName: line.productName,
      variantName: line.variantName,
      sku: line.sku,
      quantity: line.quantity,
      unitPrice: centsToReais(line.unitPriceCents),
      lineTotal: centsToReais(line.lineTotalCents),
    })),
  };
}
