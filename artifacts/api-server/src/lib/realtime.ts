import type { Server as HttpServer } from "node:http";
import { verifyToken } from "@clerk/backend";
import { eq, inArray } from "drizzle-orm";
import { Server } from "socket.io";
import { db, productVariantsTable, productsTable } from "@workspace/db";
import { logger } from "./logger";
import { getStorePermissionKeys, getStoreRoleSummaries } from "./rbac";
import { ensureStoreProfile } from "../middlewares/auth";

const SOCKET_PATH = "/api/socket.io";
const authenticatedRoom = "store:authenticated";

let io: Server | undefined;

export function attachRealtimeServer(httpServer: HttpServer): Server {
  if (io) throw new Error("The realtime server has already been initialized.");

  io = new Server(httpServer, {
    path: SOCKET_PATH,
    serveClient: false,
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 1_000,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (typeof token !== "string" || !token || !secretKey) {
      next(new Error("unauthorized"));
      return;
    }

    try {
      const claims = await verifyToken(token, { secretKey });
      if (typeof claims.sub !== "string" || !claims.sub) {
        next(new Error("unauthorized"));
        return;
      }

      const profile = await ensureStoreProfile(claims.sub);
      const [permissions, roles] = await Promise.all([
        getStorePermissionKeys(profile.userId),
        getStoreRoleSummaries(profile.userId),
      ]);

      socket.data.userId = profile.userId;
      await socket.join([
        authenticatedRoom,
        `user:${profile.userId}`,
        `role:${profile.role}`,
        ...roles.map((role) => `role:${role.slug}`),
        ...permissions.map((permission) => `permission:${permission}`),
      ]);
      next();
    } catch (error) {
      logger.debug({ err: error }, "Realtime connection rejected");
      next(new Error("unauthorized"));
    }
  });

  return io;
}

export function publishOrderCreated(orderId: string, orderNumber: string): void {
  io?.to("permission:orders:read").emit("order:created", { orderId, orderNumber });
}

export function publishOrderUpdated(orderId: string, userId: string | null): void {
  io?.to("permission:orders:read").emit("order:updated", { orderId });
  if (userId) io?.to(`user:${userId}`).emit("order:updated", { orderId });
}

export function publishProductUpdated(productId: string): void {
  io?.to(authenticatedRoom).emit("product:updated", { productId });
}

export async function publishStockChanged(variantIds: string[]): Promise<void> {
  if (!io || !variantIds.length) return;

  try {
    const variants = await db
      .select({
        variantId: productVariantsTable.id,
        productId: productsTable.id,
        stock: productVariantsTable.stock,
        reservedStock: productVariantsTable.reservedStock,
        minimumStock: productVariantsTable.minimumStock,
        variantActive: productVariantsTable.active,
        productActive: productsTable.active,
      })
      .from(productVariantsTable)
      .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
      .where(inArray(productVariantsTable.id, [...new Set(variantIds)]));

    const productIds = new Set<string>();
    for (const variant of variants) {
      const availableStock = variant.stock - variant.reservedStock;
      io.to("permission:inventory:read").emit("stock:changed", {
        variantId: variant.variantId,
        productId: variant.productId,
        availableStock,
      });
      if (
        variant.variantActive &&
        variant.productActive &&
        availableStock <= variant.minimumStock
      ) {
        io.to("permission:inventory:read").emit("stock:low", {
          variantId: variant.variantId,
          productId: variant.productId,
          availableStock,
          minimumStock: variant.minimumStock,
        });
      }
      productIds.add(variant.productId);
    }

    for (const productId of productIds) publishProductUpdated(productId);
  } catch (error) {
    logger.warn({ err: error }, "Could not publish realtime stock updates");
  }
}

export async function publishProductsUpdated(productIds: string[]): Promise<void> {
  if (!io || !productIds.length) return;
  for (const productId of new Set(productIds)) publishProductUpdated(productId);
}
