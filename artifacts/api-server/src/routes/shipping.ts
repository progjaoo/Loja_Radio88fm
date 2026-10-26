import { Router, type IRouter } from "express";
import { CotarFreteBody, CotarFreteResponse, GetShippingSettingsResponse, UpdateShippingSettingsBody, UpdateShippingSettingsResponse } from "@workspace/api-zod";
import { auditEventsTable, db, shippingSettingsTable } from "@workspace/db";
import { getStoreProfile, requireStoreAuth, requireStorePermission } from "../middlewares/auth";
import { clearShippingQuoteCache, cotarFrete } from "../lib/superfrete";
import { SuperfreteError, validatePostalCode } from "../lib/superfrete-client";
import { loadShippingSettings, superfreteConnectionStatus } from "../lib/shipping-settings";
import {
  adicionarEtiqueta,
  cancelarEtiqueta,
  consultarStatusRastreio,
  imprimirEtiqueta,
  pagarFinalizarEtiqueta,
  reconciliarEtiqueta,
} from "../lib/superfrete-labels";

const router: IRouter = Router();
const limits = new Map<string, { expires: number; count: number }>();
function orderIdFromParam(value: string | string[] | undefined): string | null {
  const id = Array.isArray(value) ? value[0] ?? "" : value ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
function sendLabelError(res: Parameters<Parameters<IRouter["post"]>[1]>[1], error: unknown): void {
  if (error instanceof SuperfreteError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  res.status(503).json({ error: "Não foi possível concluir a operação de frete." });
}

router.post("/frete/cotar", requireStoreAuth, async (req, res): Promise<void> => {
  const parsed = CotarFreteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Informe um CEP válido e os produtos da sacola." }); return;
  }
  const userId = getStoreProfile(res).userId;
  const now = Date.now();
  for (const [key, value] of limits) if (value.expires <= now) limits.delete(key);
  const limit = limits.get(userId) ?? { expires: now + 60_000, count: 0 };
  if (limit.count >= 30) {
    res.setHeader("Retry-After", Math.ceil((limit.expires - now) / 1000));
    res.status(429).json({ error: "Muitas consultas de frete. Aguarde um minuto e tente novamente." }); return;
  }
  limit.count++;
  limits.set(userId, limit);
  try {
    const result = await cotarFrete(parsed.data);
    res.json(CotarFreteResponse.parse(result.rates));
  } catch (error) {
    if (error instanceof SuperfreteError) {
      req.log.warn({ code: error.code }, "Shipping quote unavailable");
      res.status(error.status).json({ error: error.message, code: error.code }); return;
    }
    throw error;
  }
});

router.post("/admin/orders/:orderId/shipping-label", requireStoreAuth, requireStorePermission("shipping:manage"), async (req, res): Promise<void> => {
  const orderId = orderIdFromParam(req.params["orderId"]);
  if (!orderId) {
    res.status(400).json({ error: "Pedido inválido." });
    return;
  }
  try {
    res.status(201).json(await adicionarEtiqueta({ orderId }));
  } catch (error) {
    sendLabelError(res, error);
  }
});

router.get("/admin/orders/:orderId/shipping-label", requireStoreAuth, requireStorePermission("shipping:manage"), async (req, res): Promise<void> => {
  const orderId = orderIdFromParam(req.params["orderId"]);
  if (!orderId) {
    res.status(400).json({ error: "Pedido inválido." });
    return;
  }
  try {
    res.json(await consultarStatusRastreio(orderId));
  } catch (error) {
    sendLabelError(res, error);
  }
});

router.post("/admin/orders/:orderId/shipping-label/pay", requireStoreAuth, requireStorePermission("shipping:manage"), async (req, res): Promise<void> => {
  const orderId = orderIdFromParam(req.params["orderId"]);
  if (!orderId) {
    res.status(400).json({ error: "Pedido inválido." });
    return;
  }
  try {
    res.json(await pagarFinalizarEtiqueta(orderId));
  } catch (error) {
    sendLabelError(res, error);
  }
});

router.post("/admin/orders/:orderId/shipping-label/print", requireStoreAuth, requireStorePermission("shipping:manage"), async (req, res): Promise<void> => {
  const orderId = orderIdFromParam(req.params["orderId"]);
  if (!orderId) {
    res.status(400).json({ error: "Pedido inválido." });
    return;
  }
  try {
    res.json(await imprimirEtiqueta(orderId));
  } catch (error) {
    sendLabelError(res, error);
  }
});

router.post("/admin/orders/:orderId/shipping-label/cancel", requireStoreAuth, requireStorePermission("shipping:manage"), async (req, res): Promise<void> => {
  const orderId = orderIdFromParam(req.params["orderId"]);
  if (!orderId) {
    res.status(400).json({ error: "Pedido inválido." });
    return;
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
  try {
    res.json(await cancelarEtiqueta(orderId, reason));
  } catch (error) {
    sendLabelError(res, error);
  }
});

router.post("/admin/orders/:orderId/shipping-label/reconcile", requireStoreAuth, requireStorePermission("shipping:manage"), async (req, res): Promise<void> => {
  const orderId = orderIdFromParam(req.params["orderId"]);
  const providerLabelId = typeof req.body?.providerLabelId === "string" ? req.body.providerLabelId : "";
  if (!orderId || !providerLabelId) {
    res.status(400).json({ error: "Informe o pedido e o identificador confirmado no painel SuperFrete." });
    return;
  }
  try {
    res.json(await reconciliarEtiqueta(orderId, providerLabelId));
  } catch (error) {
    sendLabelError(res, error);
  }
});

router.get("/admin/shipping-settings", requireStoreAuth, requireStorePermission("shipping:read"), async (_req, res): Promise<void> => {
  res.json(GetShippingSettingsResponse.parse(superfreteConnectionStatus(await loadShippingSettings())));
});

router.put("/admin/shipping-settings", requireStoreAuth, requireStorePermission("shipping:manage"), async (req, res): Promise<void> => {
  const parsed = UpdateShippingSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Confira as medidas, taxas e dados do remetente." }); return;
  }
  const settings = parsed.data;
  if (settings.sender.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.sender.email)) {
    res.status(400).json({ error: "Informe um e-mail válido para o remetente." }); return;
  }
  if (settings.originPostalCode) {
    try { validatePostalCode(settings.originPostalCode); } catch {
      res.status(400).json({ error: "Informe um CEP de origem válido." }); return;
    }
  }
  const profile = getStoreProfile(res);
  await db.transaction(async tx => {
    await tx.insert(shippingSettingsTable).values({ id: "main", settings })
      .onConflictDoUpdate({ target: shippingSettingsTable.id, set: { settings, updatedAt: new Date() } });
    await tx.insert(auditEventsTable).values({
      actorId: profile.userId, actorName: profile.fullName, action: "shipping.settings_updated",
      entityType: "shipping_settings", entityId: "main",
      // No sender identity/document/address in audit records.
      details: { handlingDays: settings.handlingDays, marginPercent: settings.marginPercent, marginFixed: settings.marginFixed },
    });
  });
  clearShippingQuoteCache();
  res.json(UpdateShippingSettingsResponse.parse(superfreteConnectionStatus(await loadShippingSettings())));
});

export default router;
