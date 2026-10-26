export function reaisToCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError("A monetary amount must be a finite, non-negative number.");
  }
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("The monetary amount exceeds the safe integer range.");
  }
  return cents;
}

export function centsToReais(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError("The amount in cents must be a non-negative safe integer.");
  }
  return cents / 100;
}
