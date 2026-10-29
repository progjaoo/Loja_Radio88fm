import assert from "node:assert/strict";
import test from "node:test";
import {
  detectStoreImageType,
  getR2Configuration,
  normalizeR2Endpoint,
} from "./r2-storage.ts";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webpHeader = Buffer.from("RIFF0000WEBP", "ascii");
const avifHeader = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31, 0, 0, 0, 0, 0x61, 0x76, 0x69, 0x66, 0x6d, 0x69, 0x66, 0x31]);
const validEnvironment = {
  R2_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com/radio88-store",
  R2_BUCKET_NAME: "radio88-store",
  R2_PUBLIC_URL: "https://images.example.com",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
};

test("normalizes the supplied bucket-specific S3 URL to the account endpoint", () => {
  assert.equal(
    normalizeR2Endpoint(validEnvironment.R2_S3_ENDPOINT, "radio88-store"),
    "https://account.r2.cloudflarestorage.com",
  );
});

test("rejects other endpoint paths and non-Cloudflare or insecure endpoints", () => {
  assert.throws(() => normalizeR2Endpoint("https://account.r2.cloudflarestorage.com/other", "radio88-store"));
  assert.throws(() => normalizeR2Endpoint("http://account.r2.cloudflarestorage.com", "radio88-store"));
  assert.throws(() => normalizeR2Endpoint("https://example.com", "radio88-store"));
});

test("accepts only WebP or AVIF images with matching signatures for public object storage", () => {
  assert.equal(detectStoreImageType("image/webp", webpHeader), "image/webp");
  assert.equal(detectStoreImageType("image/webp; charset=binary", webpHeader), "image/webp");
  assert.equal(detectStoreImageType("image/avif", avifHeader), "image/avif");
  assert.equal(detectStoreImageType("image/avif", Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31, 0, 0, 0, 0, 0x6d, 0x69, 0x66, 0x31])), null);
  assert.equal(detectStoreImageType("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00])), null);
  assert.equal(detectStoreImageType("image/png", pngSignature), null);
  assert.equal(detectStoreImageType("image/svg+xml", Buffer.from("<svg/>")), null);
  assert.equal(detectStoreImageType("image/webp", Buffer.from("RIFF0000NOPE")), null);
  assert.equal(detectStoreImageType("image/avif", Buffer.from("<svg/>")), null);
});

test("reports missing configuration keys without exposing credential values", () => {
  const result = getR2Configuration({});
  assert.deepEqual(result, {
    ok: false,
    missing: [
      "R2_S3_ENDPOINT",
      "R2_BUCKET_NAME",
      "R2_PUBLIC_URL",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
    ],
    invalid: false,
  });
});

test("accepts a configured bucket endpoint and public HTTPS origin", () => {
  const result = getR2Configuration(validEnvironment);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.endpoint, "https://account.r2.cloudflarestorage.com");
    assert.equal(result.config.bucket, "radio88-store");
    assert.equal(result.config.publicUrl, "https://images.example.com");
  }
});
