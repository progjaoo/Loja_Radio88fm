import { randomUUID } from "node:crypto";
import express, { Router, type IRouter, type RequestHandler } from "express";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { UploadStoreImageResponse } from "@workspace/api-zod";
import { requireAnyStorePermission, requireStoreAuth } from "../middlewares/auth";
import {
  detectStoreImageType,
  getR2Configuration,
  MAX_STORE_IMAGE_BYTES,
  STORE_IMAGE_TYPES,
} from "../lib/r2-storage";

const router: IRouter = Router();
const supportedContentTypes = Object.keys(STORE_IMAGE_TYPES);

const readImageBody: RequestHandler = (req, res, next) => {
  const contentType = req.header("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!contentType || !supportedContentTypes.includes(contentType)) {
    res.status(415).json({ error: "Envie uma imagem JPG, PNG ou WebP." });
    return;
  }

  express.raw({ type: contentType, limit: MAX_STORE_IMAGE_BYTES })(
    req,
    res,
    (error?: unknown) => {
      if (!error) {
        next();
        return;
      }

      if (typeof error === "object" && error !== null && "status" in error && error.status === 413) {
        res.status(413).json({ error: "A imagem deve ter no máximo 8 MB." });
        return;
      }
      next(error);
    },
  );
};

router.post(
  "/admin/media",
  requireStoreAuth,
  requireAnyStorePermission("products:create", "products:update", "content:manage"),
  readImageBody,
  async (req, res): Promise<void> => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const contentType = detectStoreImageType(req.header("content-type"), body);
    if (!contentType) {
      res.status(400).json({ error: "O arquivo não corresponde a uma imagem JPG, PNG ou WebP válida." });
      return;
    }

    const storage = getR2Configuration(process.env);
    if (!storage.ok) {
      const configurationMessage = storage.invalid
        ? "Revise a configuração do Cloudflare R2."
        : `Configure os Secrets: ${storage.missing.join(", ")}.`;
      res.status(503).json({ error: `O armazenamento de imagens ainda não está pronto. ${configurationMessage}` });
      return;
    }

    const { config } = storage;
    const key = `storefront/${randomUUID()}.${STORE_IMAGE_TYPES[contentType].extension}`;
    const client = new S3Client({
      endpoint: config.endpoint,
      region: "auto",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    try {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }));

      const asset = UploadStoreImageResponse.parse({
        url: `${config.publicUrl}/${key}`,
        contentType,
        byteSize: body.length,
      });
      res.status(201).json(asset);
    } catch (error) {
      req.log?.error({ err: error }, "Failed to upload a storefront image to R2");
      res.status(502).json({ error: "Não foi possível enviar a imagem ao Cloudflare R2. Tente novamente." });
    } finally {
      client.destroy();
    }
  },
);

export default router;
