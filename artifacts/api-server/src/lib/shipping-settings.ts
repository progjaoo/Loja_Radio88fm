import { eq } from "drizzle-orm";
import { db, shippingSettingsTable } from "@workspace/db";
import { UpdateShippingSettingsBody, type ShippingSettings } from "@workspace/api-zod";
import { normalizePostalCode, validateClientConfig } from "./superfrete-client";

export function defaultShippingSettings(): ShippingSettings {
  return {
    originPostalCode: normalizePostalCode(process.env.STORE_ORIGIN_CEP ?? ""),
    handlingDays: 0, marginPercent: 0, marginFixed: 0, freeShippingAbove: null,
    defaultWeightKg: 0.3, defaultHeightCm: 4, defaultWidthCm: 16, defaultLengthCm: 24,
    sender: { name: "", document: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "", phone: "", email: "" },
  };
}

export async function loadShippingSettings(): Promise<ShippingSettings> {
  const [row] = await db.select().from(shippingSettingsTable).where(eq(shippingSettingsTable.id, "main")).limit(1);
  const defaults = defaultShippingSettings();
  const saved = row ? UpdateShippingSettingsBody.parse(row.settings) : defaults;
  return { ...saved, originPostalCode: saved.originPostalCode || defaults.originPostalCode };
}

export function superfreteConnectionStatus(settings: ShippingSettings) {
  const baseUrl = (process.env.SUPERFRETE_BASE_URL ?? "").replace(/\/+$/, "");
  const environment = baseUrl === "https://sandbox.superfrete.com" ? "sandbox" as const :
    baseUrl === "https://api.superfrete.com" ? "production" as const : "unconfigured" as const;
  let ready = /^\d{8}$/.test(settings.originPostalCode) && settings.originPostalCode !== "00000000";
  try {
    validateClientConfig({
      token: process.env.SUPERFRETE_TOKEN ?? "",
      baseUrl,
      contactEmail: process.env.SUPERFRETE_CONTACT_EMAIL ?? "",
    });
  } catch { ready = false; }
  return { settings, ready, environment };
}
