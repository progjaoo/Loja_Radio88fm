export const MAX_STORE_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_STORE_VIDEO_BYTES = Math.floor(3.5 * 1024 * 1024);

export const STORE_IMAGE_TYPES = {
  "image/jpeg": { extension: "jpg", signature: (bytes: Buffer) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  "image/png": { extension: "png", signature: (bytes: Buffer) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { extension: "webp", signature: (bytes: Buffer) => bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" },
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
