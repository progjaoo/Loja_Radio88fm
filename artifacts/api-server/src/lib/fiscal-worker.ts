import { and, asc, eq, inArray, isNull, lte, lt, or, sql } from "drizzle-orm";
import {
  db,
  emailOutboxTable,
  fiscalCategoryRulesTable,
  fiscalDocumentEventsTable,
  fiscalDocumentsTable,
  fiscalProductProfilesTable,
  fiscalRecipientsTable,
  fiscalSettingsTable,
  orderLinesTable,
  ordersTable,
  productVariantsTable,
  productsTable,
  type FiscalDocumentEvent,
} from "@workspace/db";
import { logger } from "./logger";
import { getFiscalMode, isValidCest, isValidCpfCnpj, isValidNcm, isValidOrigin, normalizeTaxNumber } from "./fiscal-validation";
import { getFiscalProfileReadiness, mergeFiscalTaxPayload } from "./fiscal-profile";
import { downloadNfeIoPdf, downloadNfeIoXml, NfeIoError, retrieveNfeIoInvoice, verifyNfeIoTestRegistration, createNfeIoInvoice } from "./nfeio-provider";
import { saveFiscalFile } from "./fiscal-files";

const POLL_INTERVAL_MS = 15_000;
const CLAIM_LEASE_MS = 5 * 60_000;
const BASE_RETRY_MS = 15_000;
const MAX_RETRY_MS = 60 * 60_000;
const BATCH_SIZE = 20;
const nfeioPaymentMethods = new Set([
  "Cash", "Cheque", "CreditCard", "DebitCard", "StoreCredict", "FoodVouchers", "MealVouchers",
  "GiftVouchers", "FuelVouchers", "BankBill", "BankDeposit", "InstantPayment", "WireTransfer",
  "Cashback", "WithoutPayment", "Others",
]);

let pollingTimer: NodeJS.Timeout | undefined;
let processing = false;

class FiscalReadinessError extends Error {}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

function retryDelay(attempts: number): number {
  return Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(Math.max(attempts - 1, 0), 8));
}

async function ensureDocumentsForPaidOrders(): Promise<void> {
  let mode: "manual" | "nfeio";
  try {
    mode = getFiscalMode();
  } catch (error) {
    logger.error({ err: error }, "Fiscal processing is paused because FISCAL_MODE is invalid.");
    return;
  }
  const missing = await db
    .select({ orderId: ordersTable.id })
    .from(ordersTable)
    .leftJoin(fiscalDocumentsTable, eq(fiscalDocumentsTable.orderId, ordersTable.id))
    .where(and(eq(ordersTable.paymentStatus, "paid"), isNull(fiscalDocumentsTable.id)))
    .orderBy(asc(ordersTable.createdAt))
    .limit(BATCH_SIZE);

  for (const row of missing) {
    await db.insert(fiscalDocumentsTable).values({
      orderId: row.orderId,
      mode,
      status: "pending",
      environment: "homologacao",
    }).onConflictDoNothing();
  }
}

function allocateFreight(freightCents: number, lineGrossCents: number[]): number[] {
  if (freightCents <= 0 || lineGrossCents.length === 0) return lineGrossCents.map(() => 0);
  const total = lineGrossCents.reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new FiscalReadinessError("Os valores dos itens não permitem distribuir o frete.");
  let allocated = 0;
  return lineGrossCents.map((value, index) => {
    const cents = index === lineGrossCents.length - 1
      ? freightCents - allocated
      : Math.floor((freightCents * value) / total);
    allocated += cents;
    return cents;
  });
}

async function buildInvoice(documentId: string): Promise<{
  settings: typeof fiscalSettingsTable.$inferSelect;
  payload: Record<string, unknown>;
}> {
  const [document] = await db.select().from(fiscalDocumentsTable).where(eq(fiscalDocumentsTable.id, documentId)).limit(1);
  if (!document) throw new FiscalReadinessError("Documento fiscal não encontrado.");
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, document.orderId)).limit(1);
  if (!order || order.paymentStatus !== "paid") throw new FiscalReadinessError("O pedido ainda não está pago.");
  const [recipient] = await db.select().from(fiscalRecipientsTable).where(eq(fiscalRecipientsTable.orderId, order.id)).limit(1);
  if (!recipient) throw new FiscalReadinessError("Destinatário fiscal não informado.");
  const [settings] = await db.select().from(fiscalSettingsTable).where(eq(fiscalSettingsTable.id, "default")).limit(1);
  if (!settings) throw new FiscalReadinessError("As configurações fiscais ainda não foram preenchidas.");

  const taxNumber = normalizeTaxNumber(recipient.taxNumber);
  if (!isValidCpfCnpj(taxNumber)) throw new FiscalReadinessError("O CPF/CNPJ do destinatário está inválido.");
  const fiscalAddress = record(recipient.address);
  const municipalityCode = String(fiscalAddress["municipalityCode"] ?? "");
  if (!/^\d{7}$/.test(municipalityCode)) throw new FiscalReadinessError("O código IBGE do município do destinatário está ausente.");

  const lines = await db
    .select({ line: orderLinesTable, variant: productVariantsTable, product: productsTable })
    .from(orderLinesTable)
    .innerJoin(productVariantsTable, eq(orderLinesTable.variantId, productVariantsTable.id))
    .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
    .where(eq(orderLinesTable.orderId, order.id))
    .orderBy(asc(orderLinesTable.id));
  if (!lines.length) throw new FiscalReadinessError("O pedido não contém itens para a NF-e.");

  const productIds = [...new Set(lines.map(({ product }) => product.id))];
  const profiles = await db.select().from(fiscalProductProfilesTable)
    .where(inArray(fiscalProductProfilesTable.productId, productIds));
  const profileByProduct = new Map(profiles.map((profile) => [profile.productId, profile]));
  const categoryIds = [...new Set(lines.map(({ line, product }) => line.fiscalCategoryId ?? product.categoryId).filter((id): id is string => !!id))];
  const categoryRules = categoryIds.length
    ? await db.select().from(fiscalCategoryRulesTable).where(inArray(fiscalCategoryRulesTable.categoryId, categoryIds))
    : [];
  const ruleByCategory = new Map(categoryRules.map((rule) => [rule.categoryId, rule]));

  const grossCents = lines.map(({ line }) => {
    const original = line.originalUnitPriceCents > 0 ? line.originalUnitPriceCents : line.unitPriceCents;
    return original * line.quantity;
  });
  const freightShares = allocateFreight(order.shippingFeeCents, grossCents);
  const invoiceItems = lines.map(({ line, product }, index) => {
    const profile = profileByProduct.get(product.id);
    const categoryId = line.fiscalCategoryId ?? product.categoryId;
    const categoryRule = categoryId ? ruleByCategory.get(categoryId) : undefined;
    const readiness = getFiscalProfileReadiness({
      profile: profile ?? null,
      taxRegime: settings.taxRegime,
      mode: document.mode,
      categoryCfop: categoryRule?.cfop,
      defaultCfop: settings.defaultCfop,
      categoryTaxPayload: categoryRule?.taxPayload,
    });
    if (!readiness.complete) {
      throw new FiscalReadinessError(`O produto ${line.sku} está com perfil fiscal pendente: ${readiness.missing.join(", ")}.`);
    }
    const ncm = line.fiscalNcm ?? profile?.ncm;
    const origin = line.fiscalOrigin ?? profile?.origin;
    const unit = line.fiscalUnit ?? profile?.unit;
    const taxUnit = line.fiscalTaxUnit ?? profile?.taxUnit;
    const cest = line.fiscalCest ?? profile?.cest ?? null;
    const cfop = profile?.cfop ?? categoryRule?.cfop ?? settings.defaultCfop;
    const tax = mergeFiscalTaxPayload(categoryRule?.taxPayload, profile?.taxPayload);
    if (!ncm || !isValidNcm(ncm)) throw new FiscalReadinessError(`O produto ${line.sku} precisa de um NCM válido (8 dígitos).`);
    if (!origin || !isValidOrigin(origin)) throw new FiscalReadinessError(`O produto ${line.sku} precisa de uma origem válida.`);
    if (!unit || !taxUnit) throw new FiscalReadinessError(`O produto ${line.sku} precisa de unidades comercial e tributável.`);
    if (!isValidCest(cest)) throw new FiscalReadinessError(`O produto ${line.sku} tem CEST inválido.`);
    if (!cfop || !/^\d{4}$/.test(cfop)) throw new FiscalReadinessError(`O produto ${line.sku} precisa de um CFOP informado pelo contador.`);
    if (!tax || !Object.keys(tax).length) throw new FiscalReadinessError(`Falta o perfil tributário do produto ${line.sku}.`);
    const taxPayload = structuredClone(tax);
    const icms = record(taxPayload["icms"]);
    if (icms["origin"] !== undefined && String(icms["origin"]) !== origin) {
      throw new FiscalReadinessError(`A origem da mercadoria do produto ${line.sku} diverge do perfil tributário.`);
    }
    taxPayload["icms"] = { ...icms, origin };

    const originalUnitPrice = line.originalUnitPriceCents > 0 ? line.originalUnitPriceCents : line.unitPriceCents;
    const grossLineCents = originalUnitPrice * line.quantity;
    const discountCents = Math.max(0, grossLineCents - line.lineTotalCents);
    return {
      code: line.sku,
      description: `${line.productName}${line.variantName ? ` - ${line.variantName}` : ""}`.slice(0, 120),
      ncm,
      cfop: Number(cfop),
      unit,
      quantity: line.quantity,
      unitAmount: centsToAmount(originalUnitPrice),
      totalAmount: centsToAmount(grossLineCents),
      unitTax: taxUnit,
      ...(cest ? { cest } : {}),
      ...(discountCents ? { discountAmount: centsToAmount(discountCents) } : {}),
      ...(freightShares[index] ? { freightAmount: centsToAmount(freightShares[index]!) } : {}),
      tax: taxPayload,
    };
  });

  if (!settings.nfeioTestSetupConfirmed || !settings.nfeioCertificateConfirmed) {
    throw new FiscalReadinessError("Verifique o cadastro estadual e confirme o certificado A1 no ambiente de Teste da NFE.io.");
  }
  if (!settings.nfeioPaymentMethod || !nfeioPaymentMethods.has(settings.nfeioPaymentMethod)) {
    throw new FiscalReadinessError("O contador precisa confirmar o método NFE.io equivalente ao PIX manual.");
  }
  if (settings.nfeioPaymentType !== "InCash" && settings.nfeioPaymentType !== "Term") {
    throw new FiscalReadinessError("O contador precisa confirmar se o pagamento será informado como à vista ou a prazo.");
  }
  if (!settings.nfeioPaymentMappingConfirmed) {
    throw new FiscalReadinessError("Aguarde a confirmação do contador sobre o método e o tipo de pagamento, inclusive para o PIX manual.");
  }
  const defaults = settings.invoiceDefaults ?? {};
  if ("taxDetermination" in defaults) {
    throw new FiscalReadinessError("O motor de cálculo NFE.io não pode ser usado; informe os impostos do contador no perfil fiscal.");
  }
  if (order.shippingMethod === "delivery" && order.shippingFeeCents > 0) {
    const transport = record(defaults["transport"]);
    if (!transport["freightModality"]) {
      throw new FiscalReadinessError("O contador precisa definir a modalidade de frete em invoiceDefaults.transport.freightModality.");
    }
  }

  const cleanDefaults = { ...defaults };
  delete cleanDefaults["buyer"];
  delete cleanDefaults["payment"];
  delete cleanDefaults["items"];
  delete cleanDefaults["environmentType"];
  const buyer = {
    name: recipient.legalName,
    federalTaxNumber: Number(taxNumber),
    email: recipient.email,
    type: taxNumber.length === 11 ? "NaturalPerson" : "LegalEntity",
    address: {
      state: String(fiscalAddress["state"] ?? "").toUpperCase(),
      city: { code: municipalityCode, name: String(fiscalAddress["city"] ?? "") },
      district: String(fiscalAddress["neighborhood"] ?? ""),
      ...(fiscalAddress["complement"] ? { additionalInformation: String(fiscalAddress["complement"]) } : {}),
      street: String(fiscalAddress["street"] ?? ""),
      number: String(fiscalAddress["number"] ?? ""),
      postalCode: String(fiscalAddress["postalCode"] ?? ""),
      country: "BRA",
      phone: order.customerPhone ?? undefined,
    },
  };
  return {
    settings,
    payload: {
      ...cleanDefaults,
      buyer,
      payment: [{
        paymentDetail: [{
          method: settings.nfeioPaymentMethod,
          paymentType: settings.nfeioPaymentType,
          amount: centsToAmount(order.totalCents),
        }],
      }],
      items: invoiceItems,
    },
  };
}

async function refreshProviderDocuments(): Promise<boolean> {
  const candidates = await db.select().from(fiscalDocumentsTable)
    .where(and(
      eq(fiscalDocumentsTable.mode, "nfeio"),
      inArray(fiscalDocumentsTable.status, ["processing", "submission_unknown", "authorized"]),
    ))
    .orderBy(asc(fiscalDocumentsTable.updatedAt))
    .limit(BATCH_SIZE);
  let retryNeeded = false;

  for (const document of candidates) {
    if (!document.nfeioInvoiceId) continue;
    const [settings] = await db.select().from(fiscalSettingsTable).where(eq(fiscalSettingsTable.id, "default")).limit(1);
    if (!settings) continue;
    const providerSettings = {
      issuerCnpj: settings.issuerCnpj,
      stateRegistration: settings.stateRegistration,
      stateTaxId: settings.stateTaxId,
    };
    try {
      const invoice = await retrieveNfeIoInvoice(providerSettings, document.nfeioInvoiceId);
      const status = String(invoice["status"] ?? "");
      const authorization = record(invoice["authorization"]);
      let nextStatus: "processing" | "authorized" | "rejected" | "cancelled" = "processing";
      if (status === "Issued") nextStatus = "authorized";
      else if (status === "Cancelled") nextStatus = "cancelled";
      else if (status === "IssueDenied" || status === "Error") nextStatus = "rejected";

      const [updated] = await db.update(fiscalDocumentsTable).set({
        status: nextStatus,
        invoiceNumber: invoice["number"] == null ? document.invoiceNumber : String(invoice["number"]),
        series: invoice["serie"] == null ? document.series : String(invoice["serie"]),
        accessKey: typeof authorization["accessKey"] === "string" ? authorization["accessKey"] : document.accessKey,
        issuedAt: invoice["issuedOn"] ? new Date(String(invoice["issuedOn"])) : document.issuedAt,
        authorizedAt: nextStatus === "authorized" ? document.authorizedAt ?? new Date() : document.authorizedAt,
        cancelledAt: nextStatus === "cancelled" ? document.cancelledAt ?? new Date() : document.cancelledAt,
        rejectionReason: nextStatus === "rejected" ? "A NFE.io rejeitou a emissão. Confira a mensagem no painel fiscal do provedor." : null,
        updatedAt: new Date(),
      }).where(eq(fiscalDocumentsTable.id, document.id)).returning();

      if (nextStatus === "authorized" && updated && (!updated.xmlObjectPath || !updated.danfeObjectPath)) {
        try {
          const [xml, pdf] = await Promise.all([
            updated.xmlObjectPath ? Promise.resolve(null) : downloadNfeIoXml(providerSettings, document.nfeioInvoiceId),
            updated.danfeObjectPath ? Promise.resolve(null) : downloadNfeIoPdf(providerSettings, document.nfeioInvoiceId),
          ]);
          const xmlObjectPath = xml ? await saveFiscalFile(xml, "xml") : updated.xmlObjectPath;
          const danfeObjectPath = pdf ? await saveFiscalFile(pdf, "pdf") : updated.danfeObjectPath;
          await db.update(fiscalDocumentsTable).set({ xmlObjectPath, danfeObjectPath, updatedAt: new Date() })
            .where(eq(fiscalDocumentsTable.id, document.id));
          await enqueueFiscalInvoiceEmail(document.id);
        } catch {
          retryNeeded = true;
          logger.warn({ fiscalDocumentId: document.id }, "NF-e was authorized but its private files are not ready yet.");
        }
      } else if (nextStatus === "authorized") {
        await enqueueFiscalInvoiceEmail(document.id);
      }
    } catch (error) {
      retryNeeded = true;
      const statusCode = error instanceof NfeIoError ? error.status : undefined;
      logger.warn({ fiscalDocumentId: document.id, statusCode }, "Could not refresh an NFE.io invoice.");
    }
  }
  return retryNeeded;
}

export async function enqueueFiscalInvoiceEmail(documentId: string): Promise<void> {
  const [document] = await db.select().from(fiscalDocumentsTable).where(eq(fiscalDocumentsTable.id, documentId)).limit(1);
  if (!document || document.status !== "authorized" || (!document.xmlObjectPath && !document.danfeObjectPath)) return;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, document.orderId)).limit(1);
  if (!order?.customerEmail) return;
  const existing = await db.select({ id: emailOutboxTable.id }).from(emailOutboxTable)
    .where(sql`${emailOutboxTable.payload}->>'documentId' = ${document.id}`).limit(1);
  if (existing.length) return;
  await db.insert(emailOutboxTable).values({
    userId: order.userId,
    recipient: order.customerEmail,
    eventType: "fiscal_invoice_authorized",
    subject: `Nota fiscal do pedido ${order.orderNumber}`,
    payload: { documentId: document.id, orderNumber: order.orderNumber },
  });
}

async function claimWebhookEvents(): Promise<FiscalDocumentEvent[]> {
  const now = new Date();
  const expired = new Date(now.getTime() - CLAIM_LEASE_MS);
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(fiscalDocumentEventsTable).where(or(
      and(
        eq(fiscalDocumentEventsTable.processingStatus, "pending"),
        or(isNull(fiscalDocumentEventsTable.nextAttemptAt), lte(fiscalDocumentEventsTable.nextAttemptAt, now)),
      ),
      and(
        eq(fiscalDocumentEventsTable.processingStatus, "processing"),
        or(isNull(fiscalDocumentEventsTable.lockedAt), lt(fiscalDocumentEventsTable.lockedAt, expired)),
      ),
    )).orderBy(asc(fiscalDocumentEventsTable.createdAt)).limit(BATCH_SIZE).for("update", { skipLocked: true });
    const claimed: FiscalDocumentEvent[] = [];
    for (const row of rows) {
      const lockedAt = new Date();
      const [updated] = await tx.update(fiscalDocumentEventsTable).set({
        processingStatus: "processing",
        attempts: sql`${fiscalDocumentEventsTable.attempts} + 1`,
        lockedAt,
        nextAttemptAt: null,
      }).where(eq(fiscalDocumentEventsTable.id, row.id)).returning();
      if (updated) claimed.push(updated);
    }
    return claimed;
  });
}

async function scheduleWebhookRetry(event: FiscalDocumentEvent): Promise<void> {
  await db.update(fiscalDocumentEventsTable).set({
    processingStatus: "pending",
    lockedAt: null,
    nextAttemptAt: new Date(Date.now() + retryDelay(event.attempts)),
    lastError: "Falha temporária ao consultar documentos fiscais do provedor.",
  }).where(and(
    eq(fiscalDocumentEventsTable.id, event.id),
    eq(fiscalDocumentEventsTable.processingStatus, "processing"),
    eq(fiscalDocumentEventsTable.lockedAt, event.lockedAt!),
  ));
}

async function processWebhookBatch(): Promise<void> {
  const events = await claimWebhookEvents();
  for (const event of events) {
    try {
      const retry = await refreshProviderDocuments();
      if (retry) throw new Error("provider refresh pending");
      await db.update(fiscalDocumentEventsTable).set({
        processingStatus: "processed",
        processedAt: new Date(),
        lockedAt: null,
        lastError: null,
      }).where(and(
        eq(fiscalDocumentEventsTable.id, event.id),
        eq(fiscalDocumentEventsTable.processingStatus, "processing"),
        eq(fiscalDocumentEventsTable.lockedAt, event.lockedAt!),
      ));
    } catch {
      await scheduleWebhookRetry(event);
      logger.warn({ fiscalEventId: event.id, attempt: event.attempts }, "Fiscal webhook processing will be retried.");
    }
  }
}

async function processPendingInvoices(): Promise<void> {
  const candidates = await db.select({
    document: fiscalDocumentsTable,
    order: ordersTable,
  }).from(fiscalDocumentsTable)
    .innerJoin(ordersTable, eq(fiscalDocumentsTable.orderId, ordersTable.id))
    .innerJoin(fiscalRecipientsTable, eq(fiscalRecipientsTable.orderId, ordersTable.id))
    .where(and(
      eq(fiscalDocumentsTable.mode, "nfeio"),
      eq(fiscalDocumentsTable.status, "pending"),
      eq(ordersTable.paymentStatus, "paid"),
    ))
    .orderBy(asc(fiscalDocumentsTable.createdAt))
    .limit(BATCH_SIZE);

  for (const { document } of candidates) {
    let prepared: Awaited<ReturnType<typeof buildInvoice>>;
    try {
      prepared = await buildInvoice(document.id);
      await verifyNfeIoTestRegistration({
        issuerCnpj: prepared.settings.issuerCnpj,
        stateRegistration: prepared.settings.stateRegistration,
        stateTaxId: prepared.settings.stateTaxId,
      });
    } catch (error) {
      const reason = error instanceof FiscalReadinessError || error instanceof NfeIoError
        ? error.message
        : "A configuração fiscal não está pronta para emissão.";
      await db.update(fiscalDocumentsTable).set({ rejectionReason: reason, updatedAt: new Date() })
        .where(and(eq(fiscalDocumentsTable.id, document.id), eq(fiscalDocumentsTable.status, "pending")));
      continue;
    }

    const now = new Date();
    const [claimed] = await db.update(fiscalDocumentsTable).set({
      status: "processing",
      submittedAt: now,
      rejectionReason: null,
      updatedAt: now,
    }).where(and(
      eq(fiscalDocumentsTable.id, document.id),
      eq(fiscalDocumentsTable.status, "pending"),
      eq(fiscalDocumentsTable.mode, "nfeio"),
    )).returning({ id: fiscalDocumentsTable.id });
    if (!claimed) continue;

    try {
      const result = await createNfeIoInvoice({
        issuerCnpj: prepared.settings.issuerCnpj,
        stateRegistration: prepared.settings.stateRegistration,
        stateTaxId: prepared.settings.stateTaxId,
      }, prepared.settings.invoiceDefaults ?? {}, prepared.payload);
      const invoiceId = typeof result.body["id"] === "string" ? result.body["id"] : undefined;
      if (!invoiceId) {
        await db.update(fiscalDocumentsTable).set({
          status: "submission_unknown",
          rejectionReason: "A NFE.io aceitou a solicitação sem retornar um identificador. Confira no painel antes de agir.",
          updatedAt: new Date(),
        }).where(eq(fiscalDocumentsTable.id, document.id));
        continue;
      }
      await db.update(fiscalDocumentsTable).set({
        nfeioInvoiceId: invoiceId,
        status: "processing",
        rejectionReason: null,
        updatedAt: new Date(),
      }).where(eq(fiscalDocumentsTable.id, document.id));
    } catch (error) {
      const statusCode = error instanceof NfeIoError ? error.status : 0;
      const uncertain = statusCode === 0 || statusCode >= 500;
      await db.update(fiscalDocumentsTable).set({
        status: uncertain ? "submission_unknown" : "rejected",
        rejectionReason: uncertain
          ? "Não foi possível confirmar o resultado. Consulte a NFE.io; não reenvie automaticamente."
          : error instanceof NfeIoError ? error.message : "A NFE.io recusou a solicitação.",
        updatedAt: new Date(),
      }).where(eq(fiscalDocumentsTable.id, document.id));
      logger.warn({ fiscalDocumentId: document.id, statusCode }, "NFE.io invoice submission did not complete.");
    }
  }
}

async function runWorker(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    await ensureDocumentsForPaidOrders();
    await processPendingInvoices();
    await refreshProviderDocuments();
    await processWebhookBatch();
  } catch (error) {
    logger.error("Fiscal background processing failed.");
  } finally {
    processing = false;
  }
}

export function startFiscalWorker(): void {
  if (pollingTimer) return;
  pollingTimer = setInterval(() => void runWorker(), POLL_INTERVAL_MS);
  pollingTimer.unref();
  void runWorker();
}

export async function refreshFiscalDocumentsFromWebhook(): Promise<void> {
  const retry = await refreshProviderDocuments();
  if (retry) throw new Error("Some NF-e provider documents are still being reconciled.");
}
