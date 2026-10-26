import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, asc, eq, isNull, lte, lt, or, sql } from "drizzle-orm";
import { db, emailOutboxTable, fiscalDocumentsTable, profilesTable, type EmailOutbox } from "@workspace/db";
import { logger } from "./logger";
import { buildOrderEmailMessage } from "./email-content";
import { readFiscalFile } from "./fiscal-files";

const POLL_INTERVAL_MS = 15_000;
const BATCH_SIZE = 10;
const CLAIM_LEASE_MS = 5 * 60_000;
const BASE_RETRY_MS = 15_000;
const MAX_RETRY_MS = 60 * 60_000;
const MAX_AUTOMATIC_RETRY_AGE_MS = 23 * 60 * 60_000;

class EmailDeliveryError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

let pollingTimer: NodeJS.Timeout | undefined;
let processing = false;
let missingSenderWarningShown = false;

function retryDelay(attempts: number): number {
  return Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(Math.max(attempts - 1, 0), 8));
}

async function claimBatch(): Promise<EmailOutbox[]> {
  const now = new Date();
  const expiredLease = new Date(now.getTime() - CLAIM_LEASE_MS);

  return db.transaction(async (tx) => {
    const events = await tx
      .select()
      .from(emailOutboxTable)
      .where(
        or(
          and(
            eq(emailOutboxTable.status, "queued"),
            or(isNull(emailOutboxTable.nextAttemptAt), lte(emailOutboxTable.nextAttemptAt, now)),
          ),
          and(
            eq(emailOutboxTable.status, "processing"),
            or(isNull(emailOutboxTable.lockedAt), lt(emailOutboxTable.lockedAt, expiredLease)),
          ),
        ),
      )
      .orderBy(asc(emailOutboxTable.createdAt))
      .limit(BATCH_SIZE)
      .for("update", { skipLocked: true });

    const claimed: EmailOutbox[] = [];
    for (const event of events) {
      const lockedAt = new Date();
      const [updated] = await tx
        .update(emailOutboxTable)
        .set({
          status: "processing",
          attempts: sql`${emailOutboxTable.attempts} + 1`,
          lockedAt,
          nextAttemptAt: null,
        })
        .where(eq(emailOutboxTable.id, event.id))
        .returning();
      if (updated) claimed.push(updated);
    }
    return claimed;
  });
}

async function sendEmail(event: EmailOutbox): Promise<string | undefined> {
  let deliveryEvent = event;
  if (event.eventType === "price_drop") {
    if (!event.userId) return;
    const [profile] = await db
      .select({ email: profilesTable.email, communicationOptIn: profilesTable.communicationOptIn })
      .from(profilesTable)
      .where(eq(profilesTable.userId, event.userId));
    if (!profile?.communicationOptIn) return;
    deliveryEvent = { ...event, recipient: profile.email };
  }

  const senderAddress = process.env["STORE_EMAIL_FROM"]?.trim();
  if (!senderAddress) throw new Error("STORE_EMAIL_FROM is required to send order emails.");
  if (!/^[^\s<>]+@[^\s<>]+\.[^\s<>]+$/.test(senderAddress)) {
    throw new Error("STORE_EMAIL_FROM must be a verified sender email address.");
  }

  const message = buildOrderEmailMessage(deliveryEvent);
  const attachments: { filename: string; content: string; content_type: string }[] = [];
  if (event.eventType === "fiscal_invoice_authorized") {
    const documentId = event.payload["documentId"];
    if (typeof documentId !== "string") throw new Error("Fiscal email is missing its document reference.");
    const [document] = await db.select().from(fiscalDocumentsTable).where(eq(fiscalDocumentsTable.id, documentId)).limit(1);
    if (!document || document.status !== "authorized") throw new Error("Fiscal email document is not authorized.");
    if (document.danfeObjectPath) {
      const file = await readFiscalFile(document.danfeObjectPath);
      attachments.push({
        filename: `DANFE-${document.invoiceNumber ?? document.id}.pdf`,
        content: file.bytes.toString("base64"),
        content_type: "application/pdf",
      });
    }
    if (document.xmlObjectPath) {
      const file = await readFiscalFile(document.xmlObjectPath);
      attachments.push({
        filename: `NFe-${document.invoiceNumber ?? document.id}.xml`,
        content: file.bytes.toString("base64"),
        content_type: "application/xml",
      });
    }
    if (attachments.length !== 2) throw new Error("Fiscal email attachments are not ready.");
  }
  const connectors = new ReplitConnectors();
  const body = { from: `Rádio 88 FM <${senderAddress}>`, ...message, ...(attachments.length ? { attachments } : {}) };
  const provider = process.env["EMAIL_PROVIDER"]?.trim().toLowerCase() || "replit";
  let response: { ok: boolean; status: number; json?: () => Promise<unknown>; text?: () => Promise<string> };
  if (provider === "resend") {
    const apiKey = process.env["RESEND_API_KEY"]?.trim();
    if (!apiKey) throw new EmailDeliveryError("RESEND_API_KEY is required for the Resend provider.", false);
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": event.id,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new EmailDeliveryError("Resend request failed because of a network or timeout error.", true);
    }
  } else if (provider === "replit") {
    response = await connectors.proxy("resend", "/emails", {
      method: "POST",
      headers: { "Idempotency-Key": event.id },
      body,
    });
  } else {
    throw new EmailDeliveryError("EMAIL_PROVIDER must be either resend or replit.", false);
  }

  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new EmailDeliveryError(`Email provider returned HTTP ${response.status}.`, retryable);
  }
  if (response.json) {
    try {
      const payload = await response.json() as { id?: unknown };
      if (typeof payload.id === "string") return payload.id;
    } catch {
      // A successful provider response is enough to acknowledge delivery if it omits JSON.
    }
  }
  return undefined;
}

async function markSent(event: EmailOutbox, providerMessageId?: string): Promise<void> {
  await db
    .update(emailOutboxTable)
    .set({
      status: "sent",
      sentAt: new Date(),
      lockedAt: null,
      nextAttemptAt: null,
      lastError: null,
      providerMessageId: providerMessageId ?? null,
    })
    .where(
      and(
        eq(emailOutboxTable.id, event.id),
        eq(emailOutboxTable.status, "processing"),
        eq(emailOutboxTable.lockedAt, event.lockedAt!),
      ),
    );
}

async function scheduleRetry(event: EmailOutbox, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Email delivery failed for an unknown reason.";
  if (Date.now() - event.createdAt.getTime() >= MAX_AUTOMATIC_RETRY_AGE_MS) {
    await markFailed(event, "Automatic retry window expired; manual review is required.");
    return;
  }
  await db
    .update(emailOutboxTable)
    .set({
      status: "queued",
      lockedAt: null,
      nextAttemptAt: new Date(Date.now() + retryDelay(event.attempts)),
      lastError: message.slice(0, 2000),
    })
    .where(
      and(
        eq(emailOutboxTable.id, event.id),
        eq(emailOutboxTable.status, "processing"),
        eq(emailOutboxTable.lockedAt, event.lockedAt!),
      ),
    );
}

async function processBatch(): Promise<void> {
  if (processing) return;
  if (!emailDeliveryEnabled()) return;
  processing = true;
  try {
    const sender = process.env["STORE_EMAIL_FROM"]?.trim();
    if (!sender) {
      if (!missingSenderWarningShown) {
        logger.warn("Order email delivery is paused until STORE_EMAIL_FROM is configured.");
        missingSenderWarningShown = true;
      }
      return;
    }
    const provider = process.env["EMAIL_PROVIDER"]?.trim().toLowerCase() || "replit";
    if (provider === "resend" && !process.env["RESEND_API_KEY"]?.trim()) {
      if (!missingSenderWarningShown) {
        logger.warn("Order email delivery is paused until RESEND_API_KEY is configured.");
        missingSenderWarningShown = true;
      }
      return;
    }
    if (provider !== "resend" && provider !== "replit") {
      if (!missingSenderWarningShown) {
        logger.warn("Order email delivery is paused because EMAIL_PROVIDER is invalid.");
        missingSenderWarningShown = true;
      }
      return;
    }
    missingSenderWarningShown = false;

    const events = await claimBatch();
    for (const event of events) {
      try {
        if (Date.now() - event.createdAt.getTime() >= MAX_AUTOMATIC_RETRY_AGE_MS) {
          await markFailed(event, "Automatic retry window expired; manual review is required.");
          continue;
        }
        const providerMessageId = await sendEmail(event);
        await markSent(event, providerMessageId);
      } catch (error) {
        if (error instanceof EmailDeliveryError && !error.retryable) {
          await markFailed(event, error.message);
          logger.error({ reason: error.message, outboxId: event.id, attempts: event.attempts }, "Could not send order email; event marked failed.");
        } else {
          const reason = error instanceof EmailDeliveryError
            ? error.message
            : "Email delivery failed because of a transient internal or network error.";
          await scheduleRetry(event, reason);
          logger.error({ reason, outboxId: event.id, attempts: event.attempts }, "Could not send order email; retry scheduled.");
        }
      }
    }
  } catch (error) {
    logger.error({ err: error }, "Could not process the order email outbox.");
  } finally {
    processing = false;
  }
}

async function markFailed(event: EmailOutbox, reason: string): Promise<void> {
  await db
    .update(emailOutboxTable)
    .set({ status: "failed", lockedAt: null, nextAttemptAt: null, lastError: reason.slice(0, 500) })
    .where(
      and(
        eq(emailOutboxTable.id, event.id),
        eq(emailOutboxTable.status, "processing"),
        eq(emailOutboxTable.lockedAt, event.lockedAt!),
      ),
    );
}

function emailDeliveryEnabled(): boolean {
  const configured = process.env["EMAIL_DELIVERY_ENABLED"]?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env["NODE_ENV"] === "production" || Boolean(process.env["REPL_ID"]);
}

export function startEmailOutboxWorker(): void {
  if (!emailDeliveryEnabled()) {
    logger.warn("Order email delivery is disabled for this environment.");
    return;
  }
  if (!pollingTimer) {
    pollingTimer = setInterval(() => void processBatch(), POLL_INTERVAL_MS);
    pollingTimer.unref();
  }
  void processBatch();
}
