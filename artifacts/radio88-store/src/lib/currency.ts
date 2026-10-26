const MAX_CENTS = 999_999_999_999;

const brlNumberFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCents(cents: number): string {
  const safeCents = Number.isFinite(cents)
    ? Math.min(MAX_CENTS, Math.max(0, Math.trunc(cents)))
    : 0;
  return `R$ ${brlNumberFormat.format(safeCents / 100)}`;
}

export function parseCents(value: string): number {
  const digits = value.replace(/\D/g, "");
  if (!digits) return 0;
  return Math.min(MAX_CENTS, Number(digits));
}

export function toCents(amount: number): number {
  return Number.isFinite(amount)
    ? Math.min(MAX_CENTS, Math.max(0, Math.round(amount * 100)))
    : 0;
}

export function fromCents(cents: number): number {
  return Math.min(MAX_CENTS, Math.max(0, Math.trunc(cents))) / 100;
}
