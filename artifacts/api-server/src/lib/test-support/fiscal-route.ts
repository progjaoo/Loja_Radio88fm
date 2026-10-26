type Row = Record<string, any>;
type Predicate = (row: Row) => boolean;
type Column = { column: string };
type Table = Record<string, unknown>;

const names = [
  "auditEventsTable", "categoriesTable", "fiscalCategoryRulesTable", "fiscalDocumentEventsTable",
  "fiscalDocumentsTable", "fiscalProductProfilesTable", "fiscalRecipientsTable", "fiscalSettingsTable",
  "orderLinesTable", "ordersTable", "productsTable", "productVariantsTable",
];
const tables = Object.fromEntries(names.map(name => [
  name,
  new Proxy({}, { get: (_target, key) => ({ column: String(key) }) }),
])) as Record<string, Table>;
export const {
  auditEventsTable, categoriesTable, fiscalCategoryRulesTable, fiscalDocumentEventsTable,
  fiscalDocumentsTable, fiscalProductProfilesTable, fiscalRecipientsTable, fiscalSettingsTable,
  orderLinesTable, ordersTable, productsTable, productVariantsTable,
} = tables;

export const DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";
export let document: Row;
export let validations: { path: string; kind: string }[] = [];
export let auditEvents: Row[] = [];
export let queuedEmailIds: string[] = [];
export let invalidAttachmentKind: string | undefined;
const rowsByTable = new Map<Table, Row[]>();
const ORDER_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000003";
const VARIANT_ID = "00000000-0000-4000-8000-000000000004";

export function reset() {
  document = {
    id: DOCUMENT_ID,
    orderId: ORDER_ID,
    mode: "manual",
    status: "pending",
    environment: "homologacao",
    nfeioInvoiceId: null,
    submittedAt: null,
    xmlObjectPath: null,
    danfeObjectPath: null,
  };
  validations = [];
  auditEvents = [];
  queuedEmailIds = [];
  invalidAttachmentKind = undefined;
  rowsByTable.clear();
  rowsByTable.set(orderLinesTable, [{ id: "line-1", orderId: ORDER_ID, variantId: VARIANT_ID }]);
  rowsByTable.set(productVariantsTable, [{ id: VARIANT_ID, productId: PRODUCT_ID }]);
  rowsByTable.set(productsTable, [{ id: PRODUCT_ID, name: "Produto de teste", categoryId: null }]);
  rowsByTable.set(fiscalProductProfilesTable, [{
    id: "profile-1",
    productId: PRODUCT_ID,
    ncm: "85183000",
    origin: "0",
    unit: "UN",
    taxUnit: "UN",
    cest: null,
    cfop: "5102",
    taxPayload: { icms: { cst: "102" }, pis: { cst: "07" }, cofins: { cst: "07" } },
  }]);
  rowsByTable.set(fiscalSettingsTable, [{ id: "default", taxRegime: "Simples Nacional", defaultCfop: "5102" }]);
}
reset();

export function setMissingProductProfile() {
  rowsByTable.set(fiscalProductProfilesTable, []);
}

export function setInvalidAttachment(kind?: string) {
  invalidAttachmentKind = kind;
}

class Query implements PromiseLike<Row[]> {
  private table!: Table;
  private predicate: Predicate = () => true;
  private values: Row = {};
  private readonly action: "select" | "update";

  constructor(action: "select" | "update") {
    this.action = action;
  }

  from(table: Table) { this.table = table; return this; }
  set(values: Row) { this.values = values; return this; }
  where(predicate: Predicate) { this.predicate = predicate; return this; }
  limit(_count: number) { return Promise.resolve(this.rows()); }
  returning() {
    if (this.action !== "update" || this.table !== fiscalDocumentsTable || !this.predicate(document)) {
      return Promise.resolve([]);
    }
    Object.assign(document, this.values);
    return Promise.resolve([structuredClone(document)]);
  }
  private rows() {
    if (this.action !== "select") return [];
    const rows = this.table === fiscalDocumentsTable ? [document] : rowsByTable.get(this.table) ?? [];
    return rows.filter(this.predicate).map(row => structuredClone(row));
  }
  then<TResult1 = Row[], TResult2 = never>(
    resolve?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows()).then(resolve, reject);
  }
}

export const db: {
  select: () => Query;
  update: (table?: Table) => Query;
  insert: (table?: Table) => { values: (value: Row) => Promise<Row[]> };
  transaction: <T>(callback: (tx: any) => Promise<T>) => Promise<T>;
} = {
  select: () => new Query("select"),
  update: (table?: Table) => {
    const query = new Query("update");
    if (table) query.from(table);
    return query;
  },
  insert: (table?: Table) => ({
    values: async (value: Row) => {
      if (table === auditEventsTable) auditEvents.push(structuredClone(value));
      return [];
    },
  }),
  transaction: async <T>(callback: (tx: any) => Promise<T>) => callback(db),
};

export const and = (...predicates: Predicate[]): Predicate => row => predicates.every(predicate => predicate(row));
export const eq = (column: Column, value: unknown): Predicate => row => row[column.column] === value;
export const inArray = (column: Column, values: unknown[]): Predicate => row => values.includes(row[column.column]);
export const isNull = (column: Column): Predicate => row => row[column.column] == null;
export const asc = (column: Column) => column;
export const desc = asc;
export const gte = (_column: Column, _value: unknown): Predicate => () => true;
export const lt = (_column: Column, _value: unknown): Predicate => () => true;
export const lte = (_column: Column, _value: unknown): Predicate => () => true;
export const or = (...predicates: Predicate[]): Predicate => row => predicates.some(predicate => predicate(row));
export const sql = (..._args: unknown[]) => ({});

export type MockRoute = { method: string; path: string; handlers: ((...args: any[]) => unknown)[] };
export const registeredRoutes: MockRoute[] = [];
export function Router() {
  const register = (method: string) => (path: string, ...handlers: ((...args: any[]) => unknown)[]) => {
    registeredRoutes.push({ method, path, handlers });
  };
  return {
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    patch: register("PATCH"),
    delete: register("DELETE"),
  };
}

export async function invokeRoute(
  method: string,
  path: string,
  input: { params?: Row; body?: Row; headers?: Record<string, string> },
) {
  const route = registeredRoutes.find(candidate => candidate.method === method && candidate.path === path);
  if (!route) throw new Error(`Test route was not registered: ${method} ${path}`);
  const req = {
    params: input.params ?? {},
    body: input.body ?? {},
    query: {},
    header: (name: string) => input.headers?.[name.toLowerCase()],
  };
  const res: Row = {
    statusCode: 200,
    body: undefined,
    completed: false,
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; this.completed = true; return this; },
    setHeader(_name: string, _value: string) { return this; },
    send(value: unknown) { this.body = value; this.completed = true; return this; },
  };
  let index = 0;
  const run = async (): Promise<void> => {
    if (res.completed) return;
    const handler = route.handlers[index++];
    if (!handler) return;
    let continuation: Promise<void> | undefined;
    const next = () => { continuation = run(); };
    await handler(req, res, next);
    if (continuation) await continuation;
  };
  await run();
  return { statusCode: res.statusCode as number, body: res.body as unknown };
}

export function getStoreProfile() {
  return { userId: "test-admin", fullName: "Fiscal QA" };
}
export const requireStoreAuth = (req: any, res: any, next: () => void) => {
  if (req.header("x-test-admin") !== "authorized") {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  next();
};
export const requireStorePermission = (_permission: string) => (req: any, res: any, next: () => void) => {
  if (req.header("x-test-fiscal") !== "manage") {
    res.status(403).json({ error: "Permission required." });
    return;
  }
  next();
};

export async function validateFiscalAttachment(path: string, kind: "xml" | "pdf") {
  validations.push({ path, kind });
  if (path.includes("/objects/fiscal/") === false) throw new Error("Private fiscal path required.");
  if (invalidAttachmentKind === kind) throw new Error("Test attachment content is invalid.");
  return {};
}

export async function createFiscalUploadUrl() {
  throw new Error("Upload endpoint is not part of this registration test.");
}
export async function readFiscalFile() {
  throw new Error("File download endpoint is not part of this registration test.");
}

export async function enqueueFiscalInvoiceEmail(documentId: string) {
  queuedEmailIds.push(documentId);
}

export class NfeIoError extends Error {
  status = 503;
}
export async function cancelNfeIoInvoice() { throw new Error("Not used in this test."); }
export async function sendNfeIoCorrectionLetter() { throw new Error("Not used in this test."); }
export async function verifyNfeIoTestRegistration() { throw new Error("Not used in this test."); }
