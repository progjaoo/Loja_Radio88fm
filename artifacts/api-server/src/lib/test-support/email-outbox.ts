type Row = Record<string, any>;
type Column = { column: string };
type Table = Record<string, unknown>;
export const emailOutboxTable = new Proxy({}, { get: (_target, key) => ({ column: String(key) }) });
export const fiscalDocumentsTable = new Proxy({}, { get: (_target, key) => ({ column: String(key) }) });

const sampleXml = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe>
    <dest>
      <CPF>CPF-CNPJ-TEST-MARKER</CPF>
      <enderDest><xLgr>ADDRESS-TEST-MARKER</xLgr></enderDest>
    </dest>
    <det nItem="1"><prod><xProd>ITEM SINTETICO</xProd></prod></det>
  </infNFe>
</NFe>`,
);
const samplePdf = createSyntheticDanfePdf();
let event: Row;
let document: Row;
export let delivered: Row[] = [];
export let readPaths: string[] = [];
export let logs: Row[] = [];
let deliveryResolve!: () => void;
let sentResolve!: () => void;
let settledResolve!: () => void;
let deliveryPromise: Promise<void>;
let sentPromise: Promise<void>;
let settledPromise: Promise<void>;
let liveProxy: ((service: string, path: string, options: Row) => Promise<unknown>) | undefined;

function createSyntheticDanfePdf(): Buffer {
  const lines = [
    "DANFE-TEST-MARKER - DOCUMENTO AUXILIAR DA NF-e",
    "NOTA FICTICIA - SEM VALOR FISCAL",
    "Numero: 1001    Serie: 1    Ambiente: TESTE",
    "Emitente: Radio 88 FM - dados sinteticos",
    "Destinatario: CLIENTE SINTETICO",
    "CPF/CNPJ: CPF-CNPJ-TEST-MARKER (FICTICIO)",
    "Endereco: ADDRESS-TEST-MARKER (FICTICIO)",
    "Pedido sintetico: 88-TEST",
    "Produto: ITEM SINTETICO    Quantidade: 1    Total: R$ 0,00",
    "SEM VALIDADE FISCAL - ARQUIVO GERADO PARA TESTE DE E-MAIL",
  ];
  const escape = (value: string) => value.replace(/[\\()]/g, "\\$&");
  const stream = [
    "BT",
    "/F2 15 Tf",
    "48 782 Td",
    `(${escape(lines[0]!)}) Tj`,
    "/F2 11 Tf",
    "0 -28 Td",
    `(${escape(lines[1]!)}) Tj`,
    "/F1 9 Tf",
    ...lines.slice(2).flatMap((line) => ["0 -25 Td", `(${escape(line)}) Tj`]),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n%DANFE-TEST-MARKER\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "binary"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

function makePromises() {
  deliveryPromise = new Promise(resolve => { deliveryResolve = resolve; });
  sentPromise = new Promise(resolve => { sentResolve = resolve; });
  settledPromise = new Promise(resolve => { settledResolve = resolve; });
}

export function reset(options: { recipient?: string; eventId?: string } = {}) {
  delivered = [];
  readPaths = [];
  logs = [];
  liveProxy = undefined;
  event = {
    id: options.eventId ?? "email-event-test",
    status: "queued",
    attempts: 0,
    createdAt: new Date(),
    providerMessageId: null,
    lockedAt: null,
    nextAttemptAt: null,
    eventType: "fiscal_invoice_authorized",
    recipient: options.recipient ?? "customer@example.test",
    subject: "Nota fiscal do pedido 88-TEST",
    payload: { documentId: "fiscal-document-test", orderNumber: "88-TEST" },
  };
  document = {
    id: "fiscal-document-test",
    status: "authorized",
    invoiceNumber: "1001",
    xmlObjectPath: "/objects/fiscal/private-xml",
    danfeObjectPath: "/objects/fiscal/private-pdf",
  };
  makePromises();
}
reset();

export function waitForDelivery() {
  return deliveryPromise;
}

export function waitForSent() {
  return sentPromise;
}

export function waitForSettled() {
  return settledPromise;
}

export function getEmailStatus() {
  return event.status;
}

export function getProviderMessageId() {
  return event.providerMessageId;
}

export function getLastError() {
  return event.lastError;
}

export function setLiveProxy(proxy: (service: string, path: string, options: Row) => Promise<unknown>) {
  liveProxy = proxy;
}

export const logger = {
  warn: (...values: unknown[]) => logs.push({ level: "warn", values }),
  error: (...values: unknown[]) => logs.push({ level: "error", values }),
};

export async function readFiscalFile(path: string) {
  readPaths.push(path);
  if (path === document.xmlObjectPath) return { bytes: Buffer.from(sampleXml), type: "application/xml" };
  if (path === document.danfeObjectPath) return { bytes: Buffer.from(samplePdf), type: "application/pdf" };
  throw new Error("Unknown in-memory fiscal object.");
}

export class ReplitConnectors {
  async proxy(service: string, path: string, options: Row) {
    delivered.push({ service, path, options: structuredClone(options) });
    deliveryResolve();
    if (liveProxy) return liveProxy(service, path, options);
    return { ok: true, text: async () => "" };
  }
}

function selectedRows(table: Table): Row[] {
  if (table === emailOutboxTable) return event.status === "queued" ? [event] : [];
  if (table === fiscalDocumentsTable) return [document];
  return [];
}

function applyUpdate(table: Table, update: Row): Row[] {
  if (table === emailOutboxTable) {
    if (typeof update["attempts"] === "object") event.attempts += 1;
    for (const [key, value] of Object.entries(update)) {
      if (key !== "attempts") event[key] = value;
    }
    if (event.status === "sent") sentResolve();
    if (event.status === "sent" || event.status === "queued" || event.status === "failed") settledResolve();
    return [event];
  }
  return [];
}

class Query implements PromiseLike<Row[]> {
  private table!: Table;
  private update: Row = {};

  private readonly kind: "select" | "update";

  constructor(kind: "select" | "update") {
    this.kind = kind;
  }

  from(table: Table) {
    this.table = table;
    return this;
  }
  set(values: Row) { this.update = values; return this; }
  where(_predicate: unknown) { return this; }
  orderBy(_sort: unknown) { return this; }
  limit(_count: number) { return this; }
  for(_mode: string, _options?: unknown) {
    return Promise.resolve(this.rows());
  }
  returning() { return Promise.resolve(this.kind === "update" ? applyUpdate(this.table, this.update) : this.rows()); }
  private rows() { return this.kind === "select" ? selectedRows(this.table) : []; }
  then<TResult1 = Row[], TResult2 = never>(
    resolve?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const result = this.kind === "update" ? applyUpdate(this.table, this.update) : this.rows();
    return Promise.resolve(result).then(resolve, reject);
  }
}

export const db: {
  select: () => Query;
  update: (table?: Table) => Query;
  transaction: <T>(callback: (tx: any) => Promise<T>) => Promise<T>;
} = {
  select: () => new Query("select"),
  update: (_table?: Table) => {
    const query = new Query("update");
    if (_table) query.from(_table);
    return query;
  },
  transaction: async <T>(callback: (tx: any) => Promise<T>) => callback(db),
};

export const asc = (column: Column) => column;
export const and = (...conditions: unknown[]) => conditions;
export const eq = (column: Column, value: unknown) => ({ column, value });
export const isNull = (column: Column) => ({ column, isNull: true });
export const lte = (column: Column, value: unknown) => ({ column, value });
export const lt = (column: Column, value: unknown) => ({ column, value });
export const or = (...conditions: unknown[]) => conditions;
export const sql = (..._args: unknown[]) => ({ increment: true });
