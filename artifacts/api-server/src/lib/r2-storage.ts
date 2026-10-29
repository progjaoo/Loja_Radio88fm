// Keep the raw upload below Vercel Functions' 4.5 MB request payload limit.
export const MAX_STORE_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_STORE_VIDEO_BYTES = Math.floor(3.5 * 1024 * 1024);

export const STORE_IMAGE_TYPES = {
  "image/webp": { extension: "webp", signature: (bytes: Buffer) => bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" },
  "image/avif": { extension: "avif", signature: (bytes: Buffer) => {
    if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return false;
    const boxSize = bytes.readUInt32BE(0);
    if (boxSize < 16 || boxSize > bytes.length) return false;
    const brand = (offset: number) => bytes.toString("ascii", offset, offset + 4);
    if (brand(8) === "avif" || brand(8) === "avis") return true;
    for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
      if (brand(offset) === "avif" || brand(offset) === "avis") return true;
    }
    return false;
  } },
} as const;

export type StoreImageContentType = keyof typeof STORE_IMAGE_TYPES;

export type R2Configuration = {
  endpoint: string;
  bucket: string;
  publicUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type R2ConfigurationResult =
  | { ok: true; config: R2Configuration }
  | { ok: false; missing: string[]; invalid: boolean };

export function normalizeR2Endpoint(endpointValue: string, bucket: string): string {
  const endpoint = new URL(endpointValue);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !endpoint.hostname.endsWith(".r2.cloudflarestorage.com")
  ) {
    throw new Error("Invalid R2 S3 endpoint.");
  }

  const path = endpoint.pathname.replace(/\/+$/, "");
  if (path && path !== `/${bucket}`) {
    throw new Error("The R2 S3 endpoint path must be empty or match the bucket name.");
  }

  return endpoint.origin;
}

export function getR2Configuration(
  environment: Record<string, string | undefined>,
): R2ConfigurationResult {
  const required = [
    "R2_S3_ENDPOINT",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_URL",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ] as const;
  const missing = required.filter((name) => !environment[name]?.trim());
  if (missing.length) return { ok: false, missing: [...missing], invalid: false };

  try {
    const bucket = environment.R2_BUCKET_NAME!.trim();
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new Error("Invalid R2 bucket name.");
    }

    const publicUrl = new URL(environment.R2_PUBLIC_URL!.trim());
    if (
      publicUrl.protocol !== "https:" ||
      publicUrl.username ||
      publicUrl.password ||
      publicUrl.search ||
      publicUrl.hash ||
      (publicUrl.pathname !== "" && publicUrl.pathname !== "/")
    ) {
      throw new Error("Invalid R2 public URL.");
    }

    return {
      ok: true,
      config: {
        endpoint: normalizeR2Endpoint(environment.R2_S3_ENDPOINT!.trim(), bucket),
        bucket,
        publicUrl: publicUrl.origin,
        accessKeyId: environment.R2_ACCESS_KEY_ID!,
        secretAccessKey: environment.R2_SECRET_ACCESS_KEY!,
      },
    };
  } catch {
    return { ok: false, missing: [], invalid: true };
  }
}

export function detectStoreImageType(
  contentType: string | undefined,
  bytes: Buffer,
): StoreImageContentType | null {
  const mime = contentType?.split(";", 1)[0].trim().toLowerCase();
  if (!mime || !Object.hasOwn(STORE_IMAGE_TYPES, mime)) return null;

  const supportedType = mime as StoreImageContentType;
  return STORE_IMAGE_TYPES[supportedType].signature(bytes) ? supportedType : null;
}
