// In-memory adapter for the SQL operations used by the real admin order route.
// It deliberately does not implement order/payment rules: those run in admin.ts.
type Row = Record<string, any>;
type Column = { column: string };
type Table = { name: string } & Record<string, any>;
type Predicate = (row: Row) => boolean;

export const tableNames = [
  "auditEventsTable", "categoriesTable", "emailOutboxTable", "orderLinesTable",
  "ordersTable", "paymentsTable", "productVariantsTable", "productLinesTable",
  "productImagesTable", "productsTable", "profilesTable", "stockReservationsTable",
  "stockMovementsTable",
];
export const tables = Object.fromEntries(tableNames.map((name) => [
  name,
  new Proxy({ name }, {
    get(target, key) {
      return key === "name" ? target.name : { column: String(key) };
    },
  }),
])) as Record<string, Table>;

export const ORDER_ID = "00000000-0000-4000-8000-000000000001";
export const VARIANT_ID = "00000000-0000-4000-8000-000000000002";
export const RESERVATION_ID = "00000000-0000-4000-8000-000000000003";
export let rows: Record<string, Row[]> = {};
export let permissions: string[] = [];
export let broadcasts: unknown[][] = [];
export let failUpdateTable: string | undefined;
export let locks: string[] = [];

export function reset(status = "awaiting_payment", paymentStatus = "pending", shippingMethod = "pickup") {
  rows = Object.fromEntries(tableNames.map((name) => [name, []]));
  permissions = ["orders:update", "payments:confirm", "payments:refund"];
  broadcasts = [];
  locks = [];
  failUpdateTable = undefined;
  const paid = paymentStatus === "paid" || paymentStatus === "refunded";
  const terminal = status === "cancelled" || status === "returned";
  rows.ordersTable.push({
    id: ORDER_ID, userId: "customer", orderNumber: "88-TEST", status, paymentStatus,
    shippingMethod, shippingLabel: shippingMethod === "pickup" ? "Retirada" : "Entrega", shippingAddress: null,
    trackingCode: null, subtotalCents: 2000, shippingFeeCents: 0, totalCents: 2000,
    paymentInstructions: "Confirmação manual de PIX", createdAt: new Date("2026-01-01T12:00:00Z"),
  });
  rows.profilesTable.push({ userId: "customer", email: "customer@example.test" });
  rows.paymentsTable.push({ orderId: ORDER_ID, status: paymentStatus });
  rows.productVariantsTable.push({
    id: VARIANT_ID, stock: paid && !terminal ? 8 : 10,
    reservedStock: !paid && !terminal ? 2 : 0,
  });
  rows.stockReservationsTable.push({
    id: RESERVATION_ID, orderId: ORDER_ID, variantId: VARIANT_ID, quantity: 2,
    status: terminal ? "released" : paid ? "committed" : "reserved",
  });
}

export const eq = (column: Column, value: unknown): Predicate => (row) => row[column.column] === value;
export const gte = (column: Column, value: number): Predicate => (row) => row[column.column] >= value;
export const inArray = (column: Column, values: unknown[]): Predicate => (row) => values.includes(row[column.column]);
export const and = (...conditions: Predicate[]): Predicate => (row) => conditions.every((condition) => condition(row));
export const asc = (column: Column) => column;
export const desc = asc;
export function sql(strings: TemplateStringsArray, column: Column, quantity: number) {
  const operation = strings[1].trim();
  if (operation !== "-" && operation !== "+") throw new Error(`Unsupported test SQL: ${operation}`);
  return { evaluate: (row: Row) => row[column.column] + (operation === "-" ? -quantity : quantity) };
}

function project(row: Row, selection?: Record<string, Column>) {
  return selection
    ? Object.fromEntries(Object.entries(selection).map(([key, column]) => [key, row[column.column]]))
    : structuredClone(row);
}

class Query implements PromiseLike<Row[]> {
  private table!: Table;
  private predicate: Predicate = () => true;
  private selection?: Record<string, Column>;
  private values: Row = {};
  private maximum = Infinity;
  private mode: "select" | "update";
  constructor(mode: "select" | "update", selection?: Record<string, Column>, table?: Table) {
    this.mode = mode;
    this.selection = selection;
    if (table) this.table = table;
  }
  from(table: Table) { this.table = table; return this; }
  where(predicate: Predicate) { this.predicate = predicate; return this; }
  limit(maximum: number) { this.maximum = maximum; return this; }
  orderBy() { return this; }
  for(mode: string) {
    if (mode !== "update") throw new Error(`Unsupported lock: ${mode}`);
    locks.push(this.table.name);
    return this;
  }
  set(values: Row) { this.values = values; return this; }
  returning(selection?: Record<string, Column>) { this.selection = selection; return this; }
  then<TResult1 = Row[], TResult2 = never>(
    resolve?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve().then(() => {
      if (this.mode === "update" && failUpdateTable === this.table.name) return [];
      const found = rows[this.table.name].filter(this.predicate).slice(0, this.maximum);
      if (this.mode === "update") {
        for (const row of found) {
          const evaluated = Object.fromEntries(Object.entries(this.values).map(([key, value]) => [
            key, value && typeof value.evaluate === "function" ? value.evaluate(row) : value,
          ]));
          Object.assign(row, evaluated);
        }
      }
      return found.map((row) => project(row, this.selection));
    }).then(resolve, reject);
  }
}

interface TestDatabase {
  select(selection?: Record<string, Column>): Query;
  update(table: Table): Query;
  insert(table: Table): { values(value: Row): Promise<void> };
  transaction<T>(run: (tx: TestDatabase) => Promise<T>): Promise<T>;
}

export const db: TestDatabase = {
  select: (selection?: Record<string, Column>) => new Query("select", selection),
  update: (table: Table) => new Query("update", undefined, table),
  insert: (table: Table) => ({
    values: async (value: Row) => { rows[table.name].push(structuredClone(value)); },
  }),
  async transaction<T>(run: (tx: TestDatabase) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(rows);
    try { return await run(db); }
    catch (error) { rows = snapshot; throw error; }
  },
};

export function setPermissions(value: string[]) { permissions = value; }
export function setFailedUpdate(table: string) { failUpdateTable = table; }
export const getStorePermissionKeys = async () => permissions;
export const getStoreProfile = () => ({ userId: "operator", fullName: "Test operator" });
export const requireStoreAuth = (_req: unknown, _res: unknown, next: () => void) => next();
export const requireStorePermission = () => requireStoreAuth;
export const publishOrderUpdated = (...args: unknown[]) => { broadcasts.push(["order", ...args]); };
export const publishStockChanged = async (...args: unknown[]) => { broadcasts.push(["stock", ...args]); };
export const publishProductUpdated = () => {};
export const publishProductsUpdated = () => {};
