import assert from "node:assert/strict";
import test from "node:test";
import {
  detectStoreImageType,
  getR2Configuration,
  normalizeR2Endpoint,
} from "./r2-storage.ts";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webpHeader = Buffer.from("RIFF0000WEBP", "ascii");
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

test("requires image MIME type and bytes to agree", () => {
  assert.equal(detectStoreImageType("image/png", pngSignature), "image/png");
  assert.equal(detectStoreImageType("image/png; charset=binary", pngSignature), "image/png");
  assert.equal(detectStoreImageType("image/webp", webpHeader), "image/webp");
  assert.equal(detectStoreImageType("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(detectStoreImageType("image/png", Buffer.from("<script>")), null);
  assert.equal(detectStoreImageType("image/svg+xml", Buffer.from("<svg/>")), null);
  assert.equal(detectStoreImageType("image/jpeg", pngSignature), null);
  assert.equal(detectStoreImageType("image/webp", Buffer.from("RIFF0000NOPE")), null);
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
