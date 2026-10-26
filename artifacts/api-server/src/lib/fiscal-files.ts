import { randomUUID } from "node:crypto";
import { File, Storage } from "@google-cloud/storage";
import { XMLValidator } from "fast-xml-parser";
import { PDFDocument } from "pdf-lib";

const SIDECAR = "http://127.0.0.1:1106";
const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateObjectDir(): string {
  const dir = process.env["PRIVATE_OBJECT_DIR"]?.trim();
  if (!dir) throw new Error("Private object storage is not configured.");
  return dir.replace(/\/+$/, "");
}

function parsePath(fullPath: string): { bucketName: string; objectName: string } {
  const parts = fullPath.replace(/^\/+/, "").split("/");
  if (parts.length < 3 || !parts[0] || !parts.slice(1).join("/")) {
    throw new Error("Private object path is invalid.");
  }
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

async function signUrl(bucketName: string, objectName: string, method: "PUT" | "GET"): Promise<string> {
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Could not create private upload URL (HTTP ${response.status}).`);
  const body = await response.json() as { signed_url?: string };
  if (!body.signed_url) throw new Error("Private upload URL was missing from storage response.");
  return body.signed_url;
}

function fileForPath(objectPath: string): File {
  if (!objectPath.startsWith("/objects/fiscal/") || objectPath.includes("..")) {
    throw new Error("Fiscal attachment path is invalid.");
  }
  const path = `${privateObjectDir()}${objectPath.slice("/objects".length)}`;
  const { bucketName, objectName } = parsePath(path);
  return storage.bucket(bucketName).file(objectName);
}

export async function createFiscalUploadUrl(): Promise<{ uploadURL: string; objectPath: string }> {
  const objectPath = `/objects/fiscal/${randomUUID()}`;
  const { bucketName, objectName } = parsePath(`${privateObjectDir()}${objectPath.slice("/objects".length)}`);
  return { uploadURL: await signUrl(bucketName, objectName, "PUT"), objectPath };
}

export async function validateFiscalAttachment(
  objectPath: string,
  kind: "xml" | "pdf",
): Promise<File> {
  const file = fileForPath(objectPath);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);
  if (!size || size > 10 * 1024 * 1024) throw new Error("O arquivo fiscal deve ter até 10 MB.");
  const reportedType = String(metadata.contentType ?? "").toLowerCase();
  if (kind === "pdf" && reportedType !== "application/pdf") {
    throw new Error("O arquivo selecionado não foi identificado como PDF.");
  }
  if (kind === "xml" && !["application/xml", "text/xml", "application/octet-stream"].includes(reportedType)) {
    throw new Error("O arquivo selecionado não foi identificado como XML.");
  }
  const [contents] = await file.download();
  if (kind === "pdf" && !contents.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("O conteúdo do arquivo não corresponde a um PDF.");
  }
  if (kind === "xml") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
    } catch {
      throw new Error("O arquivo XML fiscal não está codificado corretamente.");
    }
    if (!text.replace(/^\uFEFF/, "").trimStart().startsWith("<")) {
      throw new Error("O conteúdo do arquivo não corresponde a um XML.");
    }
    const validation = XMLValidator.validate(text);
    if (validation !== true) {
      throw new Error("O XML fiscal está malformado ou incompleto.");
    }
  } else {
    const pdfText = contents.toString("latin1");
    if (!/%%EOF\s*$/.test(pdfText)) {
      throw new Error("O PDF da DANFE está incompleto ou corrompido.");
    }
    try {
      const document = await PDFDocument.load(contents, {
        throwOnInvalidObject: true,
        updateMetadata: false,
      });
      if (document.getPageCount() < 1) {
        throw new Error("O PDF não contém páginas.");
      }
    } catch {
      throw new Error("O PDF da DANFE está incompleto ou corrompido.");
    }
  }
  return file;
}

export async function saveFiscalFile(
  contents: Buffer,
  kind: "xml" | "pdf",
): Promise<string> {
  const objectPath = `/objects/fiscal/${randomUUID()}`;
  const { bucketName, objectName } = parsePath(`${privateObjectDir()}${objectPath.slice("/objects".length)}`);
  const file = storage.bucket(bucketName).file(objectName);
  const contentType = kind === "pdf" ? "application/pdf" : "application/xml";
  await file.save(contents, { resumable: false, metadata: { contentType } });
  return objectPath;
}

export async function readFiscalFile(objectPath: string): Promise<{ bytes: Buffer; type: string }> {
  const file = fileForPath(objectPath);
  const [metadata] = await file.getMetadata();
  const [bytes] = await file.download();
  return { bytes, type: String(metadata.contentType ?? "application/octet-stream") };
}
