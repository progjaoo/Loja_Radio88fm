import { clerkClient } from "@clerk/express";
import { Router, type IRouter } from "express";
import { and, eq, gte } from "drizzle-orm";
import {
  CancelMyOrderParams,
  CancelMyOrderResponse,
  CreateAddressBody,
  CreateAddressResponse,
  DeleteAddressParams,
  DeleteAddressResponse,
  DeleteMyProfileResponse,
  ExportMyDataResponse,
  GetMyOrderParams,
  GetMyOrderResponse,
  GetProfileResponse,
  ListAddressesResponse,
  ListMyOrdersResponse,
  UpdateAddressBody,
  UpdateAddressParams,
  UpdateAddressResponse,
  UpdateProfileBody,
  UpdateProfileResponse,
} from "@workspace/api-zod";
import {
  addressesTable,
  auditEventsTable,
  cartLinesTable,
  cartsTable,
  db,
  emailOutboxTable,
  ordersTable,
  paymentsTable,
  productVariantsTable,
  profilesTable,
  stockReservationsTable,
  stockMovementsTable,
} from "@workspace/db";
import { getOrders, getOrder, serializeOrder } from "../lib/orders";
import { getStoreProfile, requireStoreAuth } from "../middlewares/auth";
import { publishOrderUpdated, publishStockChanged } from "../lib/realtime";

const router: IRouter = Router();

router.get("/profile", requireStoreAuth, async (_req, res): Promise<void> => {
  const profile = getStoreProfile(res);
  res.json(GetProfileResponse.parse(serializeProfile(profile)));
});

router.patch("/profile", requireStoreAuth, async (req, res): Promise<void> => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [updated] = await db
    .update(profilesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(profilesTable.userId, profile.userId))
    .returning();
  res.json(UpdateProfileResponse.parse(serializeProfile(updated)));
});

router.get("/addresses", requireStoreAuth, async (_req, res): Promise<void> => {
  const profile = getStoreProfile(res);
  const addresses = await db
    .select()
    .from(addressesTable)
    .where(eq(addressesTable.userId, profile.userId))
    .orderBy(addressesTable.isDefault, addressesTable.createdAt);
  res.json(ListAddressesResponse.parse(addresses));
});

router.post("/addresses", requireStoreAuth, async (req, res): Promise<void> => {
  const parsed = CreateAddressBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [address] = await db.transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx
        .update(addressesTable)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(addressesTable.userId, profile.userId));
    }
    return tx
      .insert(addressesTable)
      .values({ ...parsed.data, userId: profile.userId })
      .returning();
  });
  res.status(201).json(CreateAddressResponse.parse(address));
});

router.patch("/addresses/:addressId", requireStoreAuth, async (req, res): Promise<void> => {
  const params = UpdateAddressParams.safeParse(req.params);
  const body = UpdateAddressBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [existing] = await db
    .select({ id: addressesTable.id })
    .from(addressesTable)
    .where(and(eq(addressesTable.id, params.data.addressId), eq(addressesTable.userId, profile.userId)));
  if (!existing) {
    res.status(404).json({ error: "Address not found." });
    return;
  }
  const [address] = await db.transaction(async (tx) => {
    if (body.data.isDefault) {
      await tx
        .update(addressesTable)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(addressesTable.userId, profile.userId));
    }
    return tx
      .update(addressesTable)
      .set({ ...body.data, updatedAt: new Date() })
      .where(and(eq(addressesTable.id, params.data.addressId), eq(addressesTable.userId, profile.userId)))
      .returning();
  });
  res.json(UpdateAddressResponse.parse(address));
});

router.delete("/addresses/:addressId", requireStoreAuth, async (req, res): Promise<void> => {
  const params = DeleteAddressParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [deleted] = await db
    .delete(addressesTable)
    .where(and(eq(addressesTable.id, params.data.addressId), eq(addressesTable.userId, profile.userId)))
    .returning({ id: addressesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Address not found." });
    return;
  }
  res.status(204).send(DeleteAddressResponse.parse(undefined));
});

router.get("/orders", requireStoreAuth, async (_req, res): Promise<void> => {
  const profile = getStoreProfile(res);
  res.json(ListMyOrdersResponse.parse((await getOrders(profile.userId)).map(serializeOrder)));
});

router.get("/orders/:orderId", requireStoreAuth, async (req, res): Promise<void> => {
  const params = GetMyOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  const order = await getOrder(params.data.orderId, profile.userId);
  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  res.json(GetMyOrderResponse.parse(serializeOrder(order)));
});

router.post("/orders/:orderId/cancel", requireStoreAuth, async (req, res): Promise<void> => {
  const params = CancelMyOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(ordersTable)
        .where(and(eq(ordersTable.id, params.data.orderId), eq(ordersTable.userId, profile.userId)))
        .for("update");
      if (!order) throw new AccountActionError(404, "Order not found.");
      if (order.status !== "awaiting_payment" || order.paymentStatus !== "pending") {
        throw new AccountActionError(400, "This order can no longer be cancelled from your account.");
      }
      const reservations = await tx
        .select()
        .from(stockReservationsTable)
        .where(
          and(
            eq(stockReservationsTable.orderId, order.id),
            eq(stockReservationsTable.status, "reserved"),
          ),
        )
        .for("update");
      for (const reservation of reservations) {
        const [current] = await tx
          .select()
          .from(productVariantsTable)
          .where(eq(productVariantsTable.id, reservation.variantId))
          .for("update");
        if (!current || current.reservedStock < reservation.quantity) {
          throw new AccountActionError(409, "O estoque reservado deste pedido está inconsistente.");
        }
        const [updated] = await tx
          .update(productVariantsTable)
          .set({
            reservedStock: current.reservedStock - reservation.quantity,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(productVariantsTable.id, reservation.variantId),
              gte(productVariantsTable.reservedStock, reservation.quantity),
            ),
          )
          .returning({ stock: productVariantsTable.stock });
        if (!updated) throw new AccountActionError(409, "Não foi possível liberar o estoque reservado.");
        await tx
          .update(stockReservationsTable)
          .set({ status: "released", updatedAt: new Date() })
          .where(eq(stockReservationsTable.id, reservation.id));
        await tx.insert(stockMovementsTable).values({
          variantId: reservation.variantId,
          actorId: profile.userId,
          orderId: order.id,
          delta: 0,
          reservedDelta: -reservation.quantity,
          movementType: "cancellation",
          quantityBefore: current.stock,
          quantityAfter: current.stock,
          reason: `Liberação de reserva por cancelamento ${order.orderNumber}`,
        });
      }
      await tx
        .update(ordersTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(ordersTable.id, order.id));
      await tx.insert(emailOutboxTable).values({
        userId: profile.userId,
        recipient: profile.email,
        eventType: "order_status_updated",
        subject: `Atualização do pedido ${order.orderNumber}`,
        payload: {
          orderNumber: order.orderNumber,
          fromStatus: order.status,
          toStatus: "cancelled",
          fromPaymentStatus: order.paymentStatus,
          toPaymentStatus: order.paymentStatus,
          trackingCode: order.trackingCode,
        },
      });
      await tx.insert(auditEventsTable).values({
        actorId: profile.userId,
        actorName: profile.fullName,
        action: "order.cancelled",
        entityType: "order",
        entityId: order.id,
        details: { orderNumber: order.orderNumber, source: "customer" },
      });
    });
  } catch (error) {
    if (error instanceof AccountActionError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
  const order = await getOrder(params.data.orderId, profile.userId);
  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  publishOrderUpdated(order.id, profile.userId);
  void publishStockChanged(order.lines.map((line) => line.variantId));
  res.json(CancelMyOrderResponse.parse(serializeOrder(order)));
});

router.get("/profile/export", requireStoreAuth, async (_req, res): Promise<void> => {
  const profile = getStoreProfile(res);
  const [addresses, orders] = await Promise.all([
    db.select().from(addressesTable).where(eq(addressesTable.userId, profile.userId)),
    getOrders(profile.userId),
  ]);
  res.json(
    ExportMyDataResponse.parse({
      exportedAt: new Date().toISOString(),
      profile: serializeProfile(profile),
      addresses,
      orders: orders.map(serializeOrder),
    }),
  );
});

router.delete("/profile/data", requireStoreAuth, async (req, res): Promise<void> => {
  const profile = getStoreProfile(res);
  const deletedEmail = `deleted+${profile.userId}@deleted.invalid`;
  await db.transaction(async (tx) => {
    await tx.delete(addressesTable).where(eq(addressesTable.userId, profile.userId));
    await tx.delete(cartLinesTable).where(eq(cartLinesTable.userId, profile.userId));
    await tx.delete(cartsTable).where(eq(cartsTable.userId, profile.userId));
    await tx
      .update(ordersTable)
      .set({
        customerName: null,
        customerEmail: null,
        customerPhone: null,
        shippingAddress: null,
        updatedAt: new Date(),
      })
      .where(eq(ordersTable.userId, profile.userId));
    await tx
      .update(emailOutboxTable)
      .set({
        recipient: deletedEmail,
        status: "cancelled",
        payload: {},
        lastError: "Recipient account was deleted before delivery.",
      })
      .where(eq(emailOutboxTable.userId, profile.userId));
    await tx
      .update(auditEventsTable)
      .set({ actorId: null, actorName: "Conta removida" })
      .where(eq(auditEventsTable.actorId, profile.userId));
    await tx
      .update(profilesTable)
      .set({
        email: deletedEmail,
        fullName: "Conta removida",
        phone: null,
        cpfEncrypted: null,
        cpfLastFour: null,
        communicationOptIn: false,
        termsAcceptedAt: null,
        privacyAcceptedAt: null,
        role: "customer",
        updatedAt: new Date(),
      })
      .where(eq(profilesTable.userId, profile.userId));
    await tx.insert(auditEventsTable).values({
      actorId: null,
      actorName: "Conta removida",
      action: "profile.anonymized",
      entityType: "profile",
      entityId: profile.userId,
      details: { source: "customer_request" },
    });
  });

  try {
    await clerkClient.users.deleteUser(profile.userId);
  } catch (error) {
    req.log.error({ error, userId: profile.userId }, "Local data was anonymized but the Clerk account could not be deleted");
    res.status(502).json({ error: "Dados da loja removidos, mas não foi possível encerrar a conta de autenticação. Contate o suporte da Rádio 88 FM." });
    return;
  }
  res.status(204).send(DeleteMyProfileResponse.parse(undefined));
});

function serializeProfile(profile: typeof profilesTable.$inferSelect) {
  return {
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    cpfLastFour: profile.cpfLastFour,
    communicationOptIn: profile.communicationOptIn,
    termsAcceptedAt: profile.termsAcceptedAt?.toISOString() ?? null,
    privacyAcceptedAt: profile.privacyAcceptedAt?.toISOString() ?? null,
  };
}

class AccountActionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export default router;
