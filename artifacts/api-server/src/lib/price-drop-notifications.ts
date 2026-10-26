import type { InsertEmailOutbox } from "@workspace/db";
import { centsToReais } from "./currency.ts";

export type PriceAlertSubscriber = {
  userId: string;
  email: string;
};

export function buildPriceDropEmailRows(
  subscribers: PriceAlertSubscriber[],
  productName: string,
  previousPriceCents: number,
  currentPriceCents: number,
  variantName?: string,
): InsertEmailOutbox[] {
  if (currentPriceCents >= previousPriceCents) return [];
  return subscribers.map(({ userId, email }) => ({
    userId,
    recipient: email,
    eventType: "price_drop",
    subject: `O preço de ${productName} baixou`,
    payload: {
      productName,
      ...(variantName ? { variantName } : {}),
      previousPrice: centsToReais(previousPriceCents),
      currentPrice: centsToReais(currentPriceCents),
    },
  }));
}
