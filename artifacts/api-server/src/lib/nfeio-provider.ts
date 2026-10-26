import { isValidCpfCnpj, normalizeTaxNumber } from "./fiscal-validation";

const API_BASE = "https://api.nfse.io";

export class NfeIoError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "NfeIoError";
  }
}

export interface NfeIoSettings {
  issuerCnpj: string | null;
  stateRegistration: string | null;
  stateTaxId: string | null;
}

export interface NfeIoResponse extends Record<string, unknown> {
  id?: string;
}

function apiCredentials(settings: NfeIoSettings): { key: string; companyId: string; stateTaxId: string } {
  const key = process.env["NFEIO_API_KEY"]?.trim();
  const companyId = process.env["NFEIO_COMPANY_ID"]?.trim();
  if (!key || !companyId || !settings.stateTaxId || !settings.stateRegistration || !settings.issuerCnpj) {
    throw new NfeIoError(503, "NFE.io ainda não está configurado para emissão.");
  }
  if (!isValidCpfCnpj(settings.issuerCnpj) || normalizeTaxNumber(settings.issuerCnpj).length !== 14) {
    throw new NfeIoError(503, "O CNPJ do emitente não está válido.");
  }
  return { key, companyId, stateTaxId: settings.stateTaxId };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function apiRequest(
  settings: NfeIoSettings,
  method: "GET" | "POST" | "DELETE" | "PUT",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: NfeIoResponse }> {
  const { key } = apiCredentials(settings);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: key,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new NfeIoError(0, "A conexão com NFE.io foi interrompida; a emissão precisa ser reconciliada antes de qualquer nova tentativa.");
  }
  if (!response.ok) {
    // Do not retain or log the provider body: it can echo recipient data.
    throw new NfeIoError(response.status, `NFE.io retornou HTTP ${response.status}.`);
  }
  if (response.status === 204) return { status: response.status, body: {} };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new NfeIoError(response.status, "NFE.io retornou uma resposta inválida.");
  }
  return { status: response.status, body: objectRecord(payload) as NfeIoResponse };
}

function escapeSegment(value: string): string {
  return encodeURIComponent(value);
}

export async function verifyNfeIoTestRegistration(
  settings: NfeIoSettings,
): Promise<void> {
  const { companyId, stateTaxId } = apiCredentials(settings);
  const result = await apiRequest(
    settings,
    "GET",
    `/v2/companies/${escapeSegment(companyId)}/statetaxes/${escapeSegment(stateTaxId)}`,
  );
  const stateTax = objectRecord(result.body["stateTax"] ?? result.body);
  const environmentType = stateTax["environmentType"];
  const taxNumber = stateTax["taxNumber"];
  if (environmentType !== "test" || stateTax["status"] !== "active") {
    throw new NfeIoError(409, "A inscrição estadual selecionada não está em homologação (Test).");
  }
  if (typeof taxNumber !== "string" ||
      normalizeTaxNumber(taxNumber) !== normalizeTaxNumber(settings.stateRegistration ?? "")) {
    throw new NfeIoError(409, "A inscrição estadual consultada não corresponde à configuração fiscal da loja.");
  }
}

export async function createNfeIoInvoice(
  settings: NfeIoSettings,
  invoiceDefaults: Record<string, unknown>,
  invoice: Record<string, unknown>,
): Promise<{ status: number; body: NfeIoResponse }> {
  const { companyId, stateTaxId } = apiCredentials(settings);
  return apiRequest(
    settings,
    "POST",
    `/v2/companies/${escapeSegment(companyId)}/statetaxes/${escapeSegment(stateTaxId)}/productinvoices`,
    { ...invoiceDefaults, ...invoice },
  );
}

export async function retrieveNfeIoInvoice(
  settings: NfeIoSettings,
  invoiceId: string,
): Promise<NfeIoResponse> {
  const { companyId } = apiCredentials(settings);
  const { body } = await apiRequest(
    settings,
    "GET",
    `/v2/companies/${escapeSegment(companyId)}/productinvoices/${escapeSegment(invoiceId)}`,
  );
  return body;
}

export async function cancelNfeIoInvoice(
  settings: NfeIoSettings,
  invoiceId: string,
  reason?: string,
): Promise<NfeIoResponse> {
  const { companyId } = apiCredentials(settings);
  const query = reason ? `?reason=${encodeURIComponent(reason)}` : "";
  const { body } = await apiRequest(
    settings,
    "DELETE",
    `/v2/companies/${escapeSegment(companyId)}/productinvoices/${escapeSegment(invoiceId)}${query}`,
  );
  return body;
}

export async function sendNfeIoCorrectionLetter(
  settings: NfeIoSettings,
  invoiceId: string,
  reason: string,
): Promise<NfeIoResponse> {
  const { companyId } = apiCredentials(settings);
  const { body } = await apiRequest(
    settings,
    "PUT",
    `/v2/companies/${escapeSegment(companyId)}/productinvoices/${escapeSegment(invoiceId)}/correctionletter`,
    { reason },
  );
  return body;
}

async function downloadProviderFile(
  settings: NfeIoSettings,
  invoiceId: string,
  kind: "pdf" | "xml",
): Promise<Buffer> {
  const { key, companyId } = apiCredentials(settings);
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE}/v2/companies/${escapeSegment(companyId)}/productinvoices/${escapeSegment(invoiceId)}/${kind}`,
      {
        headers: { Authorization: key, Accept: kind === "pdf" ? "application/pdf, application/json" : "application/xml, text/xml, application/json" },
        signal: AbortSignal.timeout(30_000),
        redirect: "follow",
      },
    );
  } catch {
    throw new NfeIoError(0, `Não foi possível baixar o arquivo ${kind.toUpperCase()} da NFE.io.`);
  }
  if (!response.ok) throw new NfeIoError(response.status, `NFE.io retornou HTTP ${response.status} no download do ${kind.toUpperCase()}.`);

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  let bytes: Buffer;
  if (contentType.includes("json")) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new NfeIoError(response.status, `Resposta de download ${kind.toUpperCase()} inválida.`);
    }
    const record = objectRecord(payload);
    const uri = record["uri"] ?? record["url"];
    if (typeof uri !== "string") throw new NfeIoError(response.status, `Link do arquivo ${kind.toUpperCase()} ausente.`);
    let signedUrl: URL;
    try {
      signedUrl = new URL(uri);
    } catch {
      throw new NfeIoError(response.status, `Link do arquivo ${kind.toUpperCase()} inválido.`);
    }
    if (signedUrl.protocol !== "https:" || signedUrl.username || signedUrl.password) {
      throw new NfeIoError(response.status, `Link do arquivo ${kind.toUpperCase()} inválido.`);
    }
    const download = await fetch(signedUrl, { signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!download.ok) throw new NfeIoError(download.status, `Não foi possível baixar o arquivo ${kind.toUpperCase()} da NFE.io.`);
    bytes = Buffer.from(await download.arrayBuffer());
  } else {
    bytes = Buffer.from(await response.arrayBuffer());
  }

  if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
    throw new NfeIoError(413, `O arquivo ${kind.toUpperCase()} excedeu o limite de 10 MB.`);
  }
  if (kind === "pdf" && !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new NfeIoError(502, "NFE.io não retornou um DANFE em PDF válido.");
  }
  if (kind === "xml" && !bytes.subarray(0, 1024).toString("utf8").replace(/^\uFEFF/, "").trimStart().startsWith("<")) {
    throw new NfeIoError(502, "NFE.io não retornou um XML válido.");
  }
  return bytes;
}

export async function downloadNfeIoPdf(settings: NfeIoSettings, invoiceId: string): Promise<Buffer> {
  return downloadProviderFile(settings, invoiceId, "pdf");
}

export async function downloadNfeIoXml(settings: NfeIoSettings, invoiceId: string): Promise<Buffer> {
  return downloadProviderFile(settings, invoiceId, "xml");
}
