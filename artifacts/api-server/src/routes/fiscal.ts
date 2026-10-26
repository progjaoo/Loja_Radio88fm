import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditEventsTable,
  categoriesTable,
  db,
  fiscalCategoryRulesTable,
  fiscalDocumentEventsTable,
  fiscalDocumentsTable,
  fiscalProductProfilesTable,
  fiscalRecipientsTable,
  fiscalSettingsTable,
  orderLinesTable,
  ordersTable,
  productsTable,
  productVariantsTable,
} from "@workspace/db";
import { getStoreProfile, requireStoreAuth, requireStorePermission } from "../middlewares/auth";
import { getStorePermissionKeys } from "../lib/rbac";
import { getFiscalMode, isValidAccessKey, isValidCpfCnpj, isValidCest, isValidNcm, isValidOrigin, normalizeTaxNumber } from "../lib/fiscal-validation";
import {
  classifyFiscalRegime,
  getFiscalProfileReadiness,
  guidedTaxFieldsFromPayload,
  mergeFiscalTaxPayload,
  mergeGuidedTaxPayload,
  type GuidedFiscalTaxFields,
} from "../lib/fiscal-profile";
import { csvValue, FISCAL_PROFILE_CSV_COLUMNS, fiscalCsvCell, guidedFieldValuesFromCsv, parseFiscalCsv } from "../lib/fiscal-profile-csv";
import { createFiscalUploadUrl, readFiscalFile, validateFiscalAttachment } from "../lib/fiscal-files";
import { cancelNfeIoInvoice, NfeIoError, sendNfeIoCorrectionLetter, verifyNfeIoTestRegistration } from "../lib/nfeio-provider";
import { enqueueFiscalInvoiceEmail } from "../lib/fiscal-worker";

const router: IRouter = Router();
const nfeioPaymentMethods = [
  "Cash", "Cheque", "CreditCard", "DebitCard", "StoreCredict", "FoodVouchers", "MealVouchers",
  "GiftVouchers", "FuelVouchers", "BankBill", "BankDeposit", "InstantPayment", "WireTransfer",
  "Cashback", "WithoutPayment", "Others",
] as const;
const baseString = (max: number) => z.string().trim().max(max);
const fiscalAddressSchema = z.object({
  postalCode: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{8}$/)),
  street: z.string().trim().min(1).max(180),
  number: z.string().trim().min(1).max(20),
  complement: z.string().trim().max(120).nullable().optional(),
  neighborhood: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()),
  municipalityCode: z.string().regex(/^\d{7}$/),
});
const recipientSchema = z.object({
  taxNumber: z.string().min(11).max(18).refine(isValidCpfCnpj, "CPF/CNPJ inválido."),
  legalName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  address: fiscalAddressSchema,
});
const settingsSchema = z.object({
  issuerLegalName: baseString(180).nullable().optional(),
  issuerTradeName: baseString(180).nullable().optional(),
  issuerCnpj: z.string().trim().max(18).nullable().optional(),
  stateRegistration: baseString(32).nullable().optional(),
  stateTaxId: baseString(128).nullable().optional(),
  taxRegime: baseString(64).nullable().optional(),
  municipalityCode: z.string().regex(/^\d{7}$/).nullable().optional(),
  issuerAddress: z.record(z.string(), z.string()).nullable().optional(),
  defaultCfop: z.string().regex(/^\d{4}$/).nullable().optional(),
  invoiceSeries: z.number().int().min(1).max(999).nullable().optional(),
  invoiceDefaults: z.record(z.string(), z.unknown()).nullable().optional(),
  nfeioPaymentMethod: z.enum(nfeioPaymentMethods).nullable().optional(),
  nfeioPaymentType: z.enum(["InCash", "Term"]).nullable().optional(),
});
const productProfileSchema = z.object({
  ncm: z.string().regex(/^\d{8}$/),
  origin: z.string().regex(/^[0-8]$/),
  unit: z.string().trim().min(1).max(6),
  taxUnit: z.string().trim().min(1).max(6),
  cest: z.string().regex(/^\d{7}$/).nullable().optional(),
  cfop: z.string().regex(/^\d{4}$/).nullable().optional(),
  taxFields: z.object({
    icmsCode: z.string().max(3),
    icmsBaseTax: z.string().max(24),
    icmsRate: z.string().max(24),
    icmsAmount: z.string().max(24),
    pisCst: z.string().max(2),
    pisBaseTax: z.string().max(24),
    pisRate: z.string().max(24),
    pisAmount: z.string().max(24),
    cofinsCst: z.string().max(2),
    cofinsBaseTax: z.string().max(24),
    cofinsRate: z.string().max(24),
    cofinsAmount: z.string().max(24),
    ipiCst: z.string().max(2),
    ipiBaseTax: z.string().max(24),
    ipiRate: z.string().max(24),
    ipiAmount: z.string().max(24),
    ibsCbsSituationCode: z.string().max(3),
    ibsCbsClassCode: z.string().max(6),
    ibsCbsBasis: z.string().max(24),
    ibsStateRate: z.string().max(24),
    ibsStateAmount: z.string().max(24),
    ibsMunicipalRate: z.string().max(24),
    ibsMunicipalAmount: z.string().max(24),
    cbsRate: z.string().max(24),
    cbsAmount: z.string().max(24),
  }),
  advancedTaxPayload: z.record(z.string(), z.unknown()).nullable().optional(),
});
const categoryRuleSchema = z.object({
  cfop: z.string().regex(/^\d{4}$/).nullable().optional(),
  taxPayload: z.record(z.string(), z.unknown()),
});

function safeId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parseDateBoundary(value: unknown, end = false): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return undefined;
  if (end) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function logAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  actorId: string,
  actorName: string | null,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditEventsTable).values({ actorId, actorName: actorName ?? "Administrador", action, entityType, entityId, details });
}

async function loadFiscalOrders(from?: Date, toExclusive?: Date) {
  const conditions = [eq(ordersTable.paymentStatus, "paid")];
  if (from) conditions.push(gte(ordersTable.createdAt, from));
  if (toExclusive) conditions.push(lt(ordersTable.createdAt, toExclusive));
  const rows = await db.select({
    order: ordersTable,
    document: fiscalDocumentsTable,
    recipient: fiscalRecipientsTable,
  }).from(ordersTable)
    .leftJoin(fiscalDocumentsTable, eq(fiscalDocumentsTable.orderId, ordersTable.id))
    .leftJoin(fiscalRecipientsTable, eq(fiscalRecipientsTable.orderId, ordersTable.id))
    .where(and(...conditions))
    .orderBy(desc(ordersTable.createdAt))
    .limit(500);
  const orderIds = rows.map(({ order }) => order.id);
  const lines = orderIds.length ? await db.select().from(orderLinesTable).where(inArray(orderLinesTable.orderId, orderIds)) : [];
  const linesByOrder = new Map<string, typeof lines>();
  for (const line of lines) {
    const current = linesByOrder.get(line.orderId) ?? [];
    current.push(line);
    linesByOrder.set(line.orderId, current);
  }
  return rows.map(({ order, document, recipient }) => ({
    order,
    document: document ?? null,
    recipient: recipient ? {
      ...recipient,
      taxNumber: recipient.taxNumber,
    } : null,
    lines: linesByOrder.get(order.id) ?? [],
  }));
}

router.post("/fiscal/nfeio/webhook", async (req, res): Promise<void> => {
  const raw = Buffer.isBuffer(req.body) ? req.body : null;
  const secret = process.env["NFEIO_WEBHOOK_SECRET"]?.trim();
  const signature = req.header("X-Hub-Signature") ?? "";
  if (!secret || secret.length < 32 || secret.length > 64) {
    res.status(503).json({ error: "Webhook fiscal não configurado." });
    return;
  }
  if (!raw || !/^sha1=[0-9a-f]{40}$/i.test(signature)) {
    res.status(400).json({ error: "Notificação fiscal inválida." });
    return;
  }
  const expected = createHmac("sha1", secret).update(raw).digest();
  const supplied = Buffer.from(signature.slice(5), "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    res.status(401).json({ error: "Assinatura do webhook inválida." });
    return;
  }
  const bodyHash = createHash("sha256").update(raw).digest("hex");
  try {
    await db.insert(fiscalDocumentEventsTable).values({
      documentId: null,
      providerEventId: null,
      dedupeKey: bodyHash,
      eventType: "nfeio.notification",
      status: "received",
      details: { bodySha256: bodyHash },
    }).onConflictDoNothing();
    res.status(200).json({ received: true });
  } catch {
    res.status(503).json({ error: "Não foi possível registrar a notificação fiscal." });
  }
});

router.get("/admin/fiscal", requireStoreAuth, requireStorePermission("fiscal:read"), async (req, res): Promise<void> => {
  const from = req.query["from"] ? parseDateBoundary(req.query["from"]) : undefined;
  const to = req.query["to"] ? parseDateBoundary(req.query["to"], true) : undefined;
  if ((req.query["from"] && !from) || (req.query["to"] && !to)) {
    res.status(400).json({ error: "Use datas válidas no formato AAAA-MM-DD." });
    return;
  }
  const [settings] = await db.select().from(fiscalSettingsTable).where(eq(fiscalSettingsTable.id, "default")).limit(1);
  const orders = await loadFiscalOrders(from, to);
  const categories = await db.select({ id: categoriesTable.id, name: categoriesTable.name }).from(categoriesTable).orderBy(asc(categoriesTable.name));
  res.json({
    settings: settings ?? null,
    mode: process.env["FISCAL_MODE"]?.trim().toLowerCase() || "manual",
    nfeioApiConfigured: Boolean(process.env["NFEIO_API_KEY"] && process.env["NFEIO_COMPANY_ID"]),
    webhookConfigured: Boolean(process.env["NFEIO_WEBHOOK_SECRET"]),
    webhookPath: "/api/fiscal/nfeio/webhook",
    orders: orders.map(({ order, document, recipient, lines }) => ({
      order: {
        id: order.id, orderNumber: order.orderNumber, createdAt: order.createdAt,
        status: order.status, paymentStatus: order.paymentStatus, shippingMethod: order.shippingMethod,
        subtotalCents: order.subtotalCents, shippingFeeCents: order.shippingFeeCents, totalCents: order.totalCents,
        customerEmail: order.customerEmail,
        shippingLabelStatus: order.shippingLabelStatus,
        superfreteLabelId: order.superfreteLabelId,
        shippingLabelAttempted: Boolean(order.shippingLabelAttemptAt),
        trackingCode: order.trackingCode,
      },
      document,
      recipient,
      lines,
    })),
    categories,
  });
});

router.put("/admin/fiscal/settings", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Revise os campos das configurações fiscais." });
    return;
  }
  const input = parsed.data;
  if (input.issuerCnpj && (!isValidCpfCnpj(input.issuerCnpj) || normalizeTaxNumber(input.issuerCnpj).length !== 14)) {
    res.status(400).json({ error: "Informe um CNPJ válido para o emitente." });
    return;
  }
  const defaults = input.invoiceDefaults;
  if (defaults && JSON.stringify(defaults).length > 20_000) {
    res.status(400).json({ error: "Os campos complementares da NF-e excederam o limite de 20 KB." });
    return;
  }
  const forbidden = ["buyer", "payment", "items", "environmentType", "taxDetermination"];
  if (defaults && forbidden.some((key) => key in defaults)) {
    res.status(400).json({ error: "Não inclua comprador, pagamento, itens, ambiente ou motor de cálculo nos campos complementares." });
    return;
  }
  const actor = getStoreProfile(res);
  const [saved] = await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(fiscalSettingsTable).where(eq(fiscalSettingsTable.id, "default")).limit(1);
    const identityChanged = (["issuerCnpj", "stateRegistration", "stateTaxId"] as const)
      .some((key) => input[key] !== undefined && input[key] !== previous?.[key]);
    const paymentMappingChanged = (["nfeioPaymentMethod", "nfeioPaymentType"] as const)
      .some((key) => input[key] !== undefined && input[key] !== previous?.[key]);
    const update = {
      ...input,
      ...(identityChanged ? { nfeioTestSetupConfirmed: false, nfeioCertificateConfirmed: false } : {}),
      ...(paymentMappingChanged ? { nfeioPaymentMappingConfirmed: false } : {}),
      updatedAt: new Date(),
    };
    const [row] = await tx.insert(fiscalSettingsTable).values({ id: "default", ...update })
      .onConflictDoUpdate({ target: fiscalSettingsTable.id, set: update })
      .returning();
    await logAudit(tx, actor.userId, actor.fullName, "fiscal.settings.updated", "fiscal_settings", "default", {
      issuerConfigured: Boolean(input.issuerCnpj),
      stateTaxConfigured: Boolean(input.stateTaxId),
      paymentMethodConfigured: Boolean(input.nfeioPaymentMethod),
    });
    return [row];
  });
  res.json(saved);
});

router.post("/admin/fiscal/nfeio/verify-test-setup", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  if (req.body?.accountantConfirmedA1 !== true) {
    res.status(400).json({ error: "Peça ao contador para confirmar que o certificado A1 está instalado no ambiente de Teste da NFE.io." });
    return;
  }
  const [settings] = await db.select().from(fiscalSettingsTable).where(eq(fiscalSettingsTable.id, "default")).limit(1);
  if (!settings) {
    res.status(409).json({ error: "Preencha primeiro os dados do emitente." });
    return;
  }
  try {
    await verifyNfeIoTestRegistration({
      issuerCnpj: settings.issuerCnpj,
      stateRegistration: settings.stateRegistration,
      stateTaxId: settings.stateTaxId,
    });
  } catch (error) {
    res.status(error instanceof NfeIoError ? Math.max(400, Math.min(error.status || 503, 503)) : 503)
      .json({ error: error instanceof NfeIoError ? error.message : "Não foi possível verificar o cadastro de teste." });
    return;
  }
  const actor = getStoreProfile(res);
  const verified = await db.transaction(async (tx) => {
    const identityConditions = [
      eq(fiscalSettingsTable.id, "default"),
      settings.issuerCnpj ? eq(fiscalSettingsTable.issuerCnpj, settings.issuerCnpj) : isNull(fiscalSettingsTable.issuerCnpj),
      settings.stateRegistration ? eq(fiscalSettingsTable.stateRegistration, settings.stateRegistration) : isNull(fiscalSettingsTable.stateRegistration),
      settings.stateTaxId ? eq(fiscalSettingsTable.stateTaxId, settings.stateTaxId) : isNull(fiscalSettingsTable.stateTaxId),
    ];
    const [updated] = await tx.update(fiscalSettingsTable).set({
      nfeioTestSetupConfirmed: true,
      nfeioCertificateConfirmed: true,
      updatedAt: new Date(),
    }).where(and(...identityConditions)).returning({ id: fiscalSettingsTable.id });
    if (!updated) return false;
    await logAudit(tx, actor.userId, actor.fullName, "fiscal.nfeio.test_setup_verified", "fiscal_settings", "default", {
      testRegistrationVerified: true, accountantConfirmedA1: true,
    });
    return true;
  });
  if (!verified) {
    res.status(409).json({ error: "Os dados do emitente mudaram durante a verificação. Repita a conferência." });
    return;
  }
  res.json({ verified: true });
});

router.post("/admin/fiscal/nfeio/confirm-payment-mapping", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  if (req.body?.accountantConfirmedMapping !== true) {
    res.status(400).json({ error: "Peça ao contador para confirmar o método e o tipo de pagamento usados na NFE.io." });
    return;
  }
  const [settings] = await db.select().from(fiscalSettingsTable).where(eq(fiscalSettingsTable.id, "default")).limit(1);
  if (!settings?.nfeioPaymentMethod || !settings.nfeioPaymentType) {
    res.status(409).json({ error: "Salve primeiro o método e o tipo de pagamento confirmados pelo contador." });
    return;
  }
  const actor = getStoreProfile(res);
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(fiscalSettingsTable).set({
      nfeioPaymentMappingConfirmed: true, updatedAt: new Date(),
    }).where(and(
      eq(fiscalSettingsTable.id, "default"),
      eq(fiscalSettingsTable.nfeioPaymentMethod, settings.nfeioPaymentMethod!),
      eq(fiscalSettingsTable.nfeioPaymentType, settings.nfeioPaymentType!),
    )).returning({ id: fiscalSettingsTable.id });
    if (!row) return [];
    await logAudit(tx, actor.userId, actor.fullName, "fiscal.nfeio.payment_mapping_confirmed", "fiscal_settings", "default", {
      paymentMethod: settings.nfeioPaymentMethod,
      paymentType: settings.nfeioPaymentType,
      accountantConfirmed: true,
    });
    return [row];
  });
  if (!updated) {
    res.status(409).json({ error: "O método ou tipo de pagamento mudou durante a confirmação. Salve e confira novamente." });
    return;
  }
  res.json({ confirmed: true });
});

router.get("/admin/fiscal/profiles", requireStoreAuth, requireStorePermission("fiscal:read"), async (_req, res): Promise<void> => {
  const permissions = res.locals.storePermissions as string[] | undefined;
  const canEditAdvanced = permissions?.includes("roles:manage") ?? false;
  const [settings] = await db.select().from(fiscalSettingsTable).where(eq(fiscalSettingsTable.id, "default")).limit(1);
  const mode = getFiscalMode();
  const rows = await db.select({
    product: productsTable,
    profile: fiscalProductProfilesTable,
  }).from(productsTable)
    .leftJoin(fiscalProductProfilesTable, eq(fiscalProductProfilesTable.productId, productsTable.id))
    .orderBy(asc(productsTable.name));
  const categoryRules = await db.select({
    category: categoriesTable,
    rule: fiscalCategoryRulesTable,
  }).from(categoriesTable)
    .leftJoin(fiscalCategoryRulesTable, eq(fiscalCategoryRulesTable.categoryId, categoriesTable.id))
    .orderBy(asc(categoriesTable.name));
  const rulesByCategoryId = new Map(categoryRules.map(({ category, rule }) => [category.id, rule ?? null]));
  res.json({
    taxRegime: settings?.taxRegime ?? null,
    taxRegimeKind: classifyFiscalRegime(settings?.taxRegime),
    mode,
    canEditAdvanced,
    products: rows.map(({ product, profile }) => {
      const categoryRule = product.categoryId ? rulesByCategoryId.get(product.categoryId) : null;
      const effectiveCfop = profile?.cfop ?? categoryRule?.cfop ?? settings?.defaultCfop ?? null;
      const ownTaxPayload = profile?.taxPayload ?? null;
      const readiness = getFiscalProfileReadiness({
        profile: profile ?? null,
        taxRegime: settings?.taxRegime,
        mode,
        categoryCfop: categoryRule?.cfop,
        defaultCfop: settings?.defaultCfop,
        categoryTaxPayload: categoryRule?.taxPayload,
      });
      const profileOutput = profile
        ? {
            id: profile.id,
            productId: profile.productId,
            ncm: profile.ncm,
            origin: profile.origin,
            unit: profile.unit,
            taxUnit: profile.taxUnit,
            cest: profile.cest,
            cfop: profile.cfop,
            updatedAt: profile.updatedAt,
            ...(canEditAdvanced ? { taxPayload: ownTaxPayload } : {}),
          }
        : null;
      return {
        product: {
          id: product.id,
          name: product.name,
          categoryId: product.categoryId,
          sku: product.baseSku ?? product.internalCode ?? "",
          effectiveCfop,
        },
        profile: profileOutput,
        taxFields: guidedTaxFieldsFromPayload(mergeFiscalTaxPayload(categoryRule?.taxPayload, ownTaxPayload)),
        complete: readiness.complete,
        missing: readiness.missing,
      };
    }),
    categories: categoryRules.map(({ category, rule }) => ({
      category: { id: category.id, name: category.name },
      rule: rule ? {
        cfop: rule.cfop,
        ...(canEditAdvanced ? { taxPayload: rule.taxPayload } : {}),
        taxConfigured: Object.keys(rule.taxPayload).length > 0,
      } : null,
    })),
  });
});

router.get("/admin/fiscal/profiles/template.csv", requireStoreAuth, requireStorePermission("fiscal:manage"), async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(fiscalSettingsTable).where(eq(fiscalSettingsTable.id, "default")).limit(1);
  const products = await db.select({
    product: productsTable,
    profile: fiscalProductProfilesTable,
  }).from(productsTable)
    .leftJoin(fiscalProductProfilesTable, eq(fiscalProductProfilesTable.productId, productsTable.id))
    .orderBy(asc(productsTable.name));
  const categories = await db.select({
    category: categoriesTable,
    rule: fiscalCategoryRulesTable,
  }).from(categoriesTable)
    .leftJoin(fiscalCategoryRulesTable, eq(fiscalCategoryRulesTable.categoryId, categoriesTable.id));
  const rulesByCategoryId = new Map(categories.map(({ category, rule }) => [category.id, rule ?? null]));
  const bodyRows = products.map(({ product, profile }) => {
    const categoryRule = product.categoryId ? rulesByCategoryId.get(product.categoryId) : null;
    const effectiveTaxPayload = mergeFiscalTaxPayload(categoryRule?.taxPayload, profile?.taxPayload);
    const row: Record<string, unknown> = {
      productId: product.id,
      productName: product.name,
      sku: product.baseSku ?? product.internalCode ?? "",
      ncm: profile?.ncm ?? "",
      origin: profile?.origin ?? "",
      unit: profile?.unit ?? "",
      taxUnit: profile?.taxUnit ?? "",
      cest: profile?.cest ?? "",
      cfop: profile?.cfop ?? categoryRule?.cfop ?? settings?.defaultCfop ?? "",
      ...guidedTaxFieldsFromPayload(effectiveTaxPayload),
    };
    return FISCAL_PROFILE_CSV_COLUMNS.map(({ key }) => fiscalCsvCell(row[key])).join(";");
  });
  const csv = `\uFEFF${FISCAL_PROFILE_CSV_COLUMNS.map(({ label }) => fiscalCsvCell(label)).join(";")}\r\n${bodyRows.join("\r\n")}`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="modelo-perfis-fiscais-produtos.csv"');
  res.send(csv);
});

const fiscalProfileImportSchema = z.object({
  csvText: z.string().min(1).max(1_500_000),
});

router.post("/admin/fiscal/profiles/import", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  const parsed = fiscalProfileImportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Envie o arquivo CSV preenchido (máximo de 1,5 MB)." });
    return;
  }
  let rows: string[][];
  try {
    rows = parseFiscalCsv(parsed.data.csvText);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "O CSV não pôde ser lido." });
    return;
  }
  if (rows.length < 2) {
    res.status(400).json({ error: "O arquivo precisa conter o cabeçalho do modelo e ao menos uma linha de produto." });
    return;
  }
  const headerIndexes = new Map<string, number>();
  rows[0]!.forEach((header, index) => {
    const normalized = header.trim().replace(/^\uFEFF/, "");
    if (!headerIndexes.has(normalized)) headerIndexes.set(normalized, index);
  });
  const missingHeaders = FISCAL_PROFILE_CSV_COLUMNS.map(({ label }) => label).filter((label) => !headerIndexes.has(label));
  if (missingHeaders.length) {
    res.status(400).json({ error: `Faltam colunas do modelo: ${missingHeaders.join(", ")}.` });
    return;
  }

  const allProducts = await db.select().from(productsTable);
  const productById = new Map(allProducts.map((product) => [product.id, product]));
  const savedProfiles = await db.select().from(fiscalProductProfilesTable);
  const profileByProductId = new Map(savedProfiles.map((profile) => [profile.productId, profile]));
  const categoryRules = await db.select().from(fiscalCategoryRulesTable);
  const ruleByCategoryId = new Map(categoryRules.map((rule) => [rule.categoryId, rule]));
  const [settings] = await db.select().from(fiscalSettingsTable).where(eq(fiscalSettingsTable.id, "default")).limit(1);
  const mode = getFiscalMode();
  const rejected: { row: number; product: string; reason: string }[] = [];
  const accepted: {
    productId: string;
    productName: string;
    profile: {
      ncm: string;
      origin: string;
      unit: string;
      taxUnit: string;
      cest: string | null;
      cfop: string;
      taxPayload: Record<string, unknown>;
    };
  }[] = [];
  const seen = new Set<string>();

  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index]!;
    if (cells.every((cell) => cell.trim() === "")) continue;
    const rowNumber = index + 1;
    const productName = csvValue(cells, headerIndexes, "product_name");
    if (cells.length !== rows[0]!.length) {
      rejected.push({ row: rowNumber, product: productName, reason: "A quantidade de colunas não corresponde ao cabeçalho do modelo." });
      continue;
    }
    const productId = csvValue(cells, headerIndexes, "product_id");
    const product = productById.get(productId);
    if (!productId || !safeId(productId) || !product) {
      rejected.push({ row: rowNumber, product: productName, reason: "ID do produto inválido ou não encontrado; baixe novamente o modelo atual." });
      continue;
    }
    if (seen.has(productId)) {
      rejected.push({ row: rowNumber, product: product.name, reason: "Este produto aparece mais de uma vez no arquivo." });
      continue;
    }
    seen.add(productId);

    const ncm = csvValue(cells, headerIndexes, "ncm_8_digitos");
    const origin = csvValue(cells, headerIndexes, "origin_0_a_8");
    const unit = csvValue(cells, headerIndexes, "unidade_comercial");
    const taxUnit = csvValue(cells, headerIndexes, "unidade_tributavel");
    const cestValue = csvValue(cells, headerIndexes, "cest_opcional_7_digitos");
    const cfop = csvValue(cells, headerIndexes, "cfop_4_digitos");
    const issues: string[] = [];
    if (!isValidNcm(ncm)) issues.push("NCM precisa ter 8 dígitos.");
    if (!isValidOrigin(origin)) issues.push("Origem precisa ser um dígito de 0 a 8.");
    if (!unit || unit.length > 6) issues.push("Unidade comercial é obrigatória e aceita até 6 caracteres.");
    if (!taxUnit || taxUnit.length > 6) issues.push("Unidade tributável é obrigatória e aceita até 6 caracteres.");
    if (!isValidCest(cestValue)) issues.push("CEST, quando informado, precisa ter 7 dígitos.");
    if (!/^\d{4}$/.test(cfop)) issues.push("CFOP precisa ter 4 dígitos.");

    const taxFields: GuidedFiscalTaxFields = guidedFieldValuesFromCsv(cells, headerIndexes);
    const categoryRule = product.categoryId ? ruleByCategoryId.get(product.categoryId) : undefined;
    let taxPayload: Record<string, unknown> = {};
    try {
      const currentPayload = mergeFiscalTaxPayload(categoryRule?.taxPayload, profileByProductId.get(productId)?.taxPayload);
      taxPayload = mergeGuidedTaxPayload(currentPayload, taxFields);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "Há um valor tributário inválido.");
    }
    const readiness = getFiscalProfileReadiness({
      profile: { ncm, origin, unit, taxUnit, cest: cestValue || null, cfop, taxPayload },
      taxRegime: settings?.taxRegime,
      mode,
      categoryCfop: categoryRule?.cfop,
      defaultCfop: settings?.defaultCfop,
      categoryTaxPayload: categoryRule?.taxPayload,
    });
    issues.push(...readiness.missing);
    if (issues.length) {
      rejected.push({ row: rowNumber, product: product.name, reason: [...new Set(issues)].join(" ") });
      continue;
    }
    accepted.push({
      productId,
      productName: product.name,
      profile: { ncm, origin, unit, taxUnit, cest: cestValue || null, cfop, taxPayload },
    });
  }

  const actor = getStoreProfile(res);
  if (accepted.length) {
    await db.transaction(async (tx) => {
      for (const row of accepted) {
        await tx.insert(fiscalProductProfilesTable).values({
          productId: row.productId,
          ...row.profile,
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: fiscalProductProfilesTable.productId,
          set: { ...row.profile, updatedAt: new Date() },
        });
        await logAudit(tx, actor.userId, actor.fullName, "fiscal.product_profile.imported", "product", row.productId, {
          ncm: row.profile.ncm,
          source: "csv",
        });
      }
    });
  }
  res.json({
    imported: accepted.length,
    rejected,
    importedProducts: accepted.map(({ productName }) => productName),
  });
});

router.put("/admin/fiscal/profiles/products/:productId", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  const productId = routeParam(req.params["productId"]);
  if (!safeId(productId)) {
    res.status(400).json({ error: "Produto inválido." });
    return;
  }
  const parsed = productProfileSchema.safeParse(req.body);
  if (!parsed.success || !isValidCest(parsed.data?.cest)) {
    res.status(400).json({ error: "Informe NCM, origem, unidades e CEST válidos." });
    return;
  }
  const [product] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.id, productId)).limit(1);
  if (!product) {
    res.status(404).json({ error: "Produto não encontrado." });
    return;
  }
  const actor = getStoreProfile(res);
  const canEditAdvanced = (await getStorePermissionKeys(actor.userId)).includes("roles:manage");
  if (parsed.data.advancedTaxPayload !== undefined && !canEditAdvanced) {
    res.status(403).json({ error: "O JSON fiscal avançado é exclusivo de administradores." });
    return;
  }
  const [existingProfile] = await db.select().from(fiscalProductProfilesTable)
    .where(eq(fiscalProductProfilesTable.productId, product.id)).limit(1);
  let taxPayload: Record<string, unknown> | null;
  try {
    taxPayload = parsed.data.advancedTaxPayload !== undefined
      ? parsed.data.advancedTaxPayload
      : mergeGuidedTaxPayload(existingProfile?.taxPayload, parsed.data.taxFields);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Revise os valores fiscais informados." });
    return;
  }
  const profileValues = {
    ncm: parsed.data.ncm,
    origin: parsed.data.origin,
    unit: parsed.data.unit,
    taxUnit: parsed.data.taxUnit,
    cest: parsed.data.cest ?? null,
    cfop: parsed.data.cfop ?? null,
    taxPayload,
    updatedAt: new Date(),
  };
  const [saved] = await db.transaction(async (tx) => {
    const [profile] = await tx.insert(fiscalProductProfilesTable).values({
      productId: product.id,
      ...profileValues,
    }).onConflictDoUpdate({
      target: fiscalProductProfilesTable.productId,
      set: profileValues,
    }).returning();
    await logAudit(tx, actor.userId, actor.fullName, "fiscal.product_profile.updated", "product", product.id, { ncm: parsed.data.ncm });
    return [profile];
  });
  if (!canEditAdvanced && saved) {
    res.json({
      id: saved.id,
      productId: saved.productId,
      ncm: saved.ncm,
      origin: saved.origin,
      unit: saved.unit,
      taxUnit: saved.taxUnit,
      cest: saved.cest,
      cfop: saved.cfop,
      updatedAt: saved.updatedAt,
    });
    return;
  }
  res.json(saved);
});

router.put("/admin/fiscal/profiles/categories/:categoryId", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  const categoryId = routeParam(req.params["categoryId"]);
  if (!safeId(categoryId)) {
    res.status(400).json({ error: "Categoria inválida." });
    return;
  }
  const actor = getStoreProfile(res);
  const canEditAdvanced = (await getStorePermissionKeys(actor.userId)).includes("roles:manage");
  const cfopOnlySchema = z.object({ cfop: z.string().regex(/^\d{4}$/).nullable().optional() }).strict();
  const parsed = canEditAdvanced ? categoryRuleSchema.safeParse(req.body) : cfopOnlySchema.safeParse(req.body);
  if (!parsed.success || (!canEditAdvanced && Object.hasOwn(req.body ?? {}, "taxPayload"))) {
    res.status(400).json({ error: canEditAdvanced ? "Informe um perfil tributário de categoria válido." : "Somente administradores podem editar o JSON fiscal avançado." });
    return;
  }
  const [category] = await db.select({ id: categoriesTable.id }).from(categoriesTable).where(eq(categoriesTable.id, categoryId)).limit(1);
  if (!category) {
    res.status(404).json({ error: "Categoria não encontrada." });
    return;
  }
  const [existingRule] = await db.select().from(fiscalCategoryRulesTable)
    .where(eq(fiscalCategoryRulesTable.categoryId, category.id)).limit(1);
  const cfop = parsed.data.cfop ?? null;
  let taxPayload: Record<string, unknown> = existingRule?.taxPayload ?? {};
  if (canEditAdvanced && "taxPayload" in parsed.data) {
    taxPayload = parsed.data.taxPayload as Record<string, unknown>;
  }
  if (!Object.keys(taxPayload).length) {
    res.status(409).json({ error: "Informe um perfil tributário avançado para salvar a regra da categoria." });
    return;
  }
  const [saved] = await db.transaction(async (tx) => {
    const [rule] = await tx.insert(fiscalCategoryRulesTable).values({
      categoryId: category.id, cfop, taxPayload, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: fiscalCategoryRulesTable.categoryId,
      set: { cfop, taxPayload, updatedAt: new Date() },
    }).returning();
    await logAudit(tx, actor.userId, actor.fullName, "fiscal.category_rule.updated", "category", category.id, { cfopConfigured: Boolean(cfop) });
    return [rule];
  });
  if (!canEditAdvanced && saved) {
    res.json({
      id: saved.id,
      categoryId: saved.categoryId,
      cfop: saved.cfop,
      taxConfigured: Object.keys(saved.taxPayload).length > 0,
      updatedAt: saved.updatedAt,
    });
    return;
  }
  res.json(saved);
});

router.post("/admin/fiscal/recipients/:orderId", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  const orderId = routeParam(req.params["orderId"]);
  if (!safeId(orderId)) {
    res.status(400).json({ error: "Pedido inválido." });
    return;
  }
  const parsed = recipientSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Revise o CPF/CNPJ e os dados do destinatário fiscal." });
    return;
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  if (!order || order.paymentStatus !== "paid") {
    res.status(404).json({ error: "Pedido pago não encontrado." });
    return;
  }
  const recipient = {
    orderId: order.id,
    taxNumber: normalizeTaxNumber(parsed.data.taxNumber),
    legalName: parsed.data.legalName,
    email: parsed.data.email.toLowerCase(),
    address: parsed.data.address,
  };
  const actor = getStoreProfile(res);
  const [saved] = await db.transaction(async (tx) => {
    const [row] = await tx.insert(fiscalRecipientsTable).values(recipient)
      .onConflictDoUpdate({ target: fiscalRecipientsTable.orderId, set: { ...recipient, createdAt: new Date() } }).returning();
    await logAudit(tx, actor.userId, actor.fullName, "fiscal.recipient.updated", "order", order.id, { recipientUpdated: true });
    return [row];
  });
  res.json({ id: saved!.id, orderId: saved!.orderId, updated: true });
});

router.patch("/admin/fiscal/documents/:documentId/mode", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  const documentId = routeParam(req.params["documentId"]);
  if (!safeId(documentId)) {
    res.status(400).json({ error: "Documento fiscal inválido." });
    return;
  }
  const parsed = z.object({ mode: z.enum(["manual", "nfeio"]) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Selecione o modo manual ou NFE.io." });
    return;
  }
  const actor = getStoreProfile(res);
  const [saved] = await db.transaction(async (tx) => {
    const [row] = await tx.update(fiscalDocumentsTable).set({
      mode: parsed.data.mode, rejectionReason: null, updatedAt: new Date(),
    }).where(and(
      eq(fiscalDocumentsTable.id, documentId),
      eq(fiscalDocumentsTable.status, "pending"),
      isNull(fiscalDocumentsTable.submittedAt),
      isNull(fiscalDocumentsTable.nfeioInvoiceId),
    )).returning();
    if (!row) return [];
    await logAudit(tx, actor.userId, actor.fullName, "fiscal.document.mode_changed", "fiscal_document", row.id, { mode: row.mode });
    return [row];
  });
  if (!saved) {
    res.status(409).json({ error: "O modo só pode ser alterado antes de qualquer envio ao provedor." });
    return;
  }
  res.json(saved);
});

router.post("/admin/fiscal/uploads", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  const parsed = z.object({ kind: z.enum(["xml", "pdf"]) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Selecione XML ou DANFE em PDF." });
    return;
  }
  res.json(await createFiscalUploadUrl());
});

router.put("/admin/fiscal/documents/:documentId/manual", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  const documentId = routeParam(req.params["documentId"]);
  if (!safeId(documentId)) {
    res.status(400).json({ error: "Documento fiscal inválido." });
    return;
  }
  const parsed = z.object({
    invoiceNumber: z.string().trim().min(1).max(32),
    series: z.string().trim().min(1).max(12),
    accessKey: z.string().refine(isValidAccessKey, "Chave de acesso inválida."),
    environment: z.enum(["homologacao", "producao"]),
    xmlObjectPath: z.string().startsWith("/objects/fiscal/"),
    danfeObjectPath: z.string().startsWith("/objects/fiscal/"),
    issuedAt: z.string().datetime().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Informe número, série, chave de acesso, XML e DANFE." });
    return;
  }
  const [document] = await db.select().from(fiscalDocumentsTable).where(eq(fiscalDocumentsTable.id, documentId)).limit(1);
  if (!document || document.mode !== "manual" || !["pending", "rejected"].includes(document.status) || document.nfeioInvoiceId || document.submittedAt) {
    res.status(409).json({ error: "Este documento não pode ser registrado como nota manual." });
    return;
  }
  const orderLines = await db.select().from(orderLinesTable)
    .where(eq(orderLinesTable.orderId, document.orderId));
  const orderVariants = orderLines.length
    ? await db.select().from(productVariantsTable)
      .where(inArray(productVariantsTable.id, orderLines.map((line) => line.variantId)))
    : [];
  const variantById = new Map(orderVariants.map((variant) => [variant.id, variant]));
  const productIds = [...new Set(orderVariants.map((variant) => variant.productId))];
  const orderProducts = productIds.length
    ? await db.select().from(productsTable).where(inArray(productsTable.id, productIds))
    : [];
  const productById = new Map(orderProducts.map((product) => [product.id, product]));
  const orderProductRows = orderLines.flatMap((line) => {
    const variant = variantById.get(line.variantId);
    const product = variant ? productById.get(variant.productId) : undefined;
    return product ? [{ line, product }] : [];
  });
  if (!orderProductRows.length) {
    res.status(409).json({ error: "A emissão está bloqueada: os produtos do pedido não puderam ser conferidos." });
    return;
  }
  const orderProductIds = orderProductRows.map(({ product }) => product.id);
  const productProfiles = await db.select().from(fiscalProductProfilesTable)
    .where(inArray(fiscalProductProfilesTable.productId, orderProductIds));
  const profileByProductId = new Map(productProfiles.map((profile) => [profile.productId, profile]));
  const categoryIds = [...new Set(orderProductRows.map(({ product }) => product.categoryId).filter((id): id is string => !!id))];
  const categoryRules = categoryIds.length
    ? await db.select().from(fiscalCategoryRulesTable).where(inArray(fiscalCategoryRulesTable.categoryId, categoryIds))
    : [];
  const ruleByCategoryId = new Map(categoryRules.map((rule) => [rule.categoryId, rule]));
  const [fiscalSettings] = await db.select().from(fiscalSettingsTable)
    .where(eq(fiscalSettingsTable.id, "default")).limit(1);
  const pendingProfiles = orderProductRows.flatMap(({ product }) => {
    const categoryRule = product.categoryId ? ruleByCategoryId.get(product.categoryId) : undefined;
    const readiness = getFiscalProfileReadiness({
      profile: profileByProductId.get(product.id) ?? null,
      taxRegime: fiscalSettings?.taxRegime,
      mode: "manual",
      categoryCfop: categoryRule?.cfop,
      defaultCfop: fiscalSettings?.defaultCfop,
      categoryTaxPayload: categoryRule?.taxPayload,
    });
    return readiness.complete ? [] : [`${product.name}: ${readiness.missing.join(", ")}`];
  });
  if (pendingProfiles.length) {
    res.status(409).json({ error: `A emissão está bloqueada até concluir os perfis fiscais: ${pendingProfiles.join("; ")}.` });
    return;
  }
  try {
    await Promise.all([
      validateFiscalAttachment(parsed.data.xmlObjectPath, "xml"),
      validateFiscalAttachment(parsed.data.danfeObjectPath, "pdf"),
    ]);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Arquivo fiscal inválido." });
    return;
  }
  const actor = getStoreProfile(res);
  const issuedAt = parsed.data.issuedAt ? new Date(parsed.data.issuedAt) : new Date();
  const [saved] = await db.transaction(async (tx) => {
    const [row] = await tx.update(fiscalDocumentsTable).set({
      status: "authorized",
      environment: parsed.data.environment,
      invoiceNumber: parsed.data.invoiceNumber,
      series: parsed.data.series,
      accessKey: parsed.data.accessKey,
      xmlObjectPath: parsed.data.xmlObjectPath,
      danfeObjectPath: parsed.data.danfeObjectPath,
      issuedAt,
      authorizedAt: new Date(),
      rejectionReason: null,
      updatedAt: new Date(),
    }).where(and(
      eq(fiscalDocumentsTable.id, document.id),
      inArray(fiscalDocumentsTable.status, ["pending", "rejected"]),
      isNull(fiscalDocumentsTable.nfeioInvoiceId),
      isNull(fiscalDocumentsTable.submittedAt),
    )).returning();
    if (!row) throw new Error("Documento fiscal alterado simultaneamente.");
    await logAudit(tx, actor.userId, actor.fullName, "fiscal.manual_note.authorized", "fiscal_document", document.id, { invoiceNumber: parsed.data.invoiceNumber });
    return [row];
  });
  await enqueueFiscalInvoiceEmail(saved!.id);
  res.json(saved);
});

router.post("/admin/fiscal/documents/:documentId/manual-cancellation", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  const documentId = routeParam(req.params["documentId"]);
  if (!safeId(documentId)) {
    res.status(400).json({ error: "Documento fiscal inválido." });
    return;
  }
  const parsed = z.object({
    reason: z.string().trim().min(15).max(1000),
    cancelledAt: z.string().datetime().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Informe o motivo e a data do cancelamento confirmado pela contabilidade." });
    return;
  }
  const actor = getStoreProfile(res);
  const [saved] = await db.transaction(async (tx) => {
    const [row] = await tx.update(fiscalDocumentsTable).set({
      status: "cancelled",
      cancelledAt: parsed.data.cancelledAt ? new Date(parsed.data.cancelledAt) : new Date(),
      cancellationReason: parsed.data.reason,
      updatedAt: new Date(),
    }).where(and(
      eq(fiscalDocumentsTable.id, documentId),
      eq(fiscalDocumentsTable.mode, "manual"),
      eq(fiscalDocumentsTable.status, "authorized"),
    )).returning();
    if (!row) return [];
    await tx.insert(fiscalDocumentEventsTable).values({
      documentId: row.id, eventType: "manual.cancellation.confirmed", status: "confirmed",
      details: { reasonLength: parsed.data.reason.length },
    });
    await logAudit(tx, actor.userId, actor.fullName, "fiscal.manual_note.cancelled", "fiscal_document", row.id, {});
    return [row];
  });
  if (!saved) {
    res.status(409).json({ error: "Apenas uma nota manual autorizada pode ser marcada como cancelada." });
    return;
  }
  res.json(saved);
});

router.post("/admin/fiscal/documents/:documentId/exemption", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  const documentId = routeParam(req.params["documentId"]);
  if (!safeId(documentId)) {
    res.status(400).json({ error: "Documento fiscal inválido." });
    return;
  }
  const parsed = z.object({ reason: z.string().trim().min(20).max(1000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Registre um motivo específico para a exceção fiscal (mínimo 20 caracteres)." });
    return;
  }
  const [document] = await db.select().from(fiscalDocumentsTable).where(eq(fiscalDocumentsTable.id, documentId)).limit(1);
  if (!document || document.submittedAt || document.nfeioInvoiceId || ["authorized", "cancelled"].includes(document.status)) {
    res.status(409).json({ error: "Não é possível isentar uma nota já emitida ou enviada ao provedor." });
    return;
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, document.orderId)).limit(1);
  if (order?.paymentStatus !== "paid") {
    res.status(409).json({ error: "A exceção só pode ser registrada em um pedido pago." });
    return;
  }
  const actor = getStoreProfile(res);
  const [saved] = await db.transaction(async (tx) => {
    const [row] = await tx.update(fiscalDocumentsTable).set({
      status: "exempt", exemptionReason: parsed.data.reason, updatedAt: new Date(),
    }).where(and(
      eq(fiscalDocumentsTable.id, document.id),
      isNull(fiscalDocumentsTable.submittedAt),
      isNull(fiscalDocumentsTable.nfeioInvoiceId),
    )).returning();
    if (!row) throw new Error("Documento fiscal alterado simultaneamente.");
    await logAudit(tx, actor.userId, actor.fullName, "fiscal.document.exempted", "fiscal_document", document.id, { reasonLength: parsed.data.reason.length });
    return [row];
  });
  res.json(saved);
});

router.post("/admin/fiscal/documents/:documentId/cancel", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  const documentId = routeParam(req.params["documentId"]);
  if (!safeId(documentId)) {
    res.status(400).json({ error: "Documento fiscal inválido." });
    return;
  }
  const parsed = z.object({ reason: z.string().trim().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Motivo de cancelamento inválido." });
    return;
  }
  const [document] = await db.select().from(fiscalDocumentsTable).where(eq(fiscalDocumentsTable.id, documentId)).limit(1);
  if (!document || document.status !== "authorized") {
    res.status(409).json({ error: "Somente uma nota autorizada pode ser cancelada." });
    return;
  }
  if (document.mode === "manual") {
    res.status(409).json({ error: "Registre o cancelamento manualmente junto à contabilidade antes de alterar o status." });
    return;
  }
  if (!document.nfeioInvoiceId) {
    res.status(409).json({ error: "O identificador NFE.io está ausente; não é seguro enviar o cancelamento." });
    return;
  }
  const [settings] = await db.select().from(fiscalSettingsTable).where(eq(fiscalSettingsTable.id, "default")).limit(1);
  if (!settings) {
    res.status(503).json({ error: "Configuração NFE.io ausente." });
    return;
  }
  const [claimed] = await db.update(fiscalDocumentsTable).set({
    status: "processing", rejectionReason: "Cancelamento enviado ao provedor; aguardando confirmação.", updatedAt: new Date(),
  }).where(and(eq(fiscalDocumentsTable.id, document.id), eq(fiscalDocumentsTable.status, "authorized"))).returning({ id: fiscalDocumentsTable.id });
  if (!claimed) {
    res.status(409).json({ error: "Outra ação fiscal foi iniciada para este documento." });
    return;
  }
  try {
    await cancelNfeIoInvoice({
      issuerCnpj: settings.issuerCnpj, stateRegistration: settings.stateRegistration, stateTaxId: settings.stateTaxId,
    }, document.nfeioInvoiceId, parsed.data.reason || undefined);
    await db.insert(fiscalDocumentEventsTable).values({
      documentId: document.id, eventType: "nfeio.cancellation.requested", status: "accepted", details: {},
    });
    const actor = getStoreProfile(res);
    await db.insert(auditEventsTable).values({
      actorId: actor.userId, actorName: actor.fullName, action: "fiscal.nfeio.cancellation.requested",
      entityType: "fiscal_document", entityId: document.id, details: { reasonProvided: Boolean(parsed.data.reason) },
    });
    res.status(202).json({ status: "processing" });
  } catch (error) {
    const uncertain = error instanceof NfeIoError && (error.status === 0 || error.status >= 500);
    await db.update(fiscalDocumentsTable).set({
      status: uncertain ? "submission_unknown" : "authorized",
      rejectionReason: uncertain
        ? "O resultado do cancelamento é incerto. Consulte a NFE.io antes de tentar novamente."
        : "A NFE.io recusou o cancelamento. A nota permanece autorizada.",
      updatedAt: new Date(),
    }).where(eq(fiscalDocumentsTable.id, document.id));
    res.status(uncertain ? 503 : 502).json({ error: uncertain
      ? "Resultado incerto; consulte o provedor antes de qualquer nova tentativa."
      : error instanceof NfeIoError ? error.message : "Não foi possível cancelar a NF-e." });
  }
});

router.post("/admin/fiscal/documents/:documentId/correction-letter", requireStoreAuth, requireStorePermission("fiscal:manage"), async (req, res): Promise<void> => {
  const documentId = routeParam(req.params["documentId"]);
  if (!safeId(documentId)) {
    res.status(400).json({ error: "Documento fiscal inválido." });
    return;
  }
  const parsed = z.object({ reason: z.string().trim().min(15).max(1000).regex(/^[\x20-\x7E]+$/) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A carta de correção deve ter 15 a 1.000 caracteres ASCII, sem acentos." });
    return;
  }
  const [document] = await db.select().from(fiscalDocumentsTable).where(eq(fiscalDocumentsTable.id, documentId)).limit(1);
  if (!document || document.mode !== "nfeio" || document.status !== "authorized" || !document.nfeioInvoiceId) {
    res.status(409).json({ error: "Carta de correção disponível apenas para NF-e NFE.io autorizada." });
    return;
  }
  const [settings] = await db.select().from(fiscalSettingsTable).where(eq(fiscalSettingsTable.id, "default")).limit(1);
  if (!settings) {
    res.status(503).json({ error: "Configuração NFE.io ausente." });
    return;
  }
  try {
    await sendNfeIoCorrectionLetter({
      issuerCnpj: settings.issuerCnpj, stateRegistration: settings.stateRegistration, stateTaxId: settings.stateTaxId,
    }, document.nfeioInvoiceId, parsed.data.reason);
    await db.insert(fiscalDocumentEventsTable).values({
      documentId: document.id, eventType: "nfeio.correction_letter.requested", status: "accepted",
      details: { reasonLength: parsed.data.reason.length },
    });
    const actor = getStoreProfile(res);
    await db.insert(auditEventsTable).values({
      actorId: actor.userId, actorName: actor.fullName, action: "fiscal.nfeio.correction_letter.requested",
      entityType: "fiscal_document", entityId: document.id, details: { reasonLength: parsed.data.reason.length },
    });
    res.status(202).json({ status: "processing" });
  } catch (error) {
    res.status(502).json({ error: error instanceof NfeIoError ? error.message : "Não foi possível enviar a carta de correção." });
  }
});

router.get("/admin/fiscal/documents/:documentId/files/:kind", requireStoreAuth, requireStorePermission("fiscal:read"), async (req, res): Promise<void> => {
  const documentId = routeParam(req.params["documentId"]);
  const fileKind = routeParam(req.params["kind"]);
  if (!safeId(documentId) || !["xml", "pdf"].includes(fileKind)) {
    res.status(400).json({ error: "Arquivo fiscal inválido." });
    return;
  }
  const [document] = await db.select().from(fiscalDocumentsTable).where(eq(fiscalDocumentsTable.id, documentId)).limit(1);
  const objectPath = fileKind === "xml" ? document?.xmlObjectPath : document?.danfeObjectPath;
  if (!document || !objectPath) {
    res.status(404).json({ error: "Arquivo fiscal não encontrado." });
    return;
  }
  const file = await readFiscalFile(objectPath);
  const kind = fileKind === "xml" ? "xml" : "pdf";
  res.setHeader("Content-Type", kind === "pdf" ? "application/pdf" : "application/xml");
  const filenameId = (document.invoiceNumber ?? document.id).replace(/[^a-zA-Z0-9_-]/g, "_");
  res.setHeader("Content-Disposition", `attachment; filename="nota-${filenameId}.${kind}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(file.bytes);
});

router.get("/admin/fiscal/export.csv", requireStoreAuth, requireStorePermission("fiscal:export"), async (req, res): Promise<void> => {
  const from = req.query["from"] ? parseDateBoundary(req.query["from"]) : undefined;
  const to = req.query["to"] ? parseDateBoundary(req.query["to"], true) : undefined;
  if ((req.query["from"] && !from) || (req.query["to"] && !to)) {
    res.status(400).json({ error: "Use datas válidas no formato AAAA-MM-DD." });
    return;
  }
  const rows = await loadFiscalOrders(from, to);
  const header = [
    "pedido", "data", "status_pedido", "status_fiscal", "modo", "cpf_cnpj", "destinatario", "email",
    "produto", "variacao", "sku", "quantidade", "valor_bruto", "desconto", "frete", "total_pedido",
    "serie", "numero_nfe", "chave_acesso", "motivo_isencao", "motivo_cancelamento",
  ];
  const output = [header.map(csvCell).join(",")];
  for (const { order, document, recipient, lines } of rows) {
    const values = lines.length ? lines : [null];
    for (const line of values) {
      const originalUnit = line?.originalUnitPriceCents || line?.unitPriceCents || 0;
      const gross = originalUnit * (line?.quantity ?? 0);
      const net = line?.lineTotalCents ?? 0;
      output.push([
        order.orderNumber, order.createdAt.toISOString(), order.status, document?.status ?? "sem_nota",
        document?.mode ?? "", recipient?.taxNumber ?? "", recipient?.legalName ?? "", recipient?.email ?? "",
        line?.productName ?? "", line?.variantName ?? "", line?.sku ?? "", line?.quantity ?? "",
        centsToCsv(gross), centsToCsv(Math.max(0, gross - net)), centsToCsv(order.shippingFeeCents),
        centsToCsv(order.totalCents), document?.series ?? "", document?.invoiceNumber ?? "",
        document?.accessKey ?? "", document?.exemptionReason ?? "", document?.cancellationReason ?? "",
      ].map(csvCell).join(","));
    }
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="radio88-fiscal.csv"');
  res.send(`\uFEFF${output.join("\r\n")}`);
});

function centsToCsv(value: number): string {
  return (value / 100).toFixed(2);
}

export default router;
