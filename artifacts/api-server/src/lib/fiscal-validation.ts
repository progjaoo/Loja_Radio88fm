export function normalizeTaxNumber(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidCpfCnpj(value: string): boolean {
  const digits = normalizeTaxNumber(value);
  if (/^(\d)\1+$/.test(digits)) return false;

  if (digits.length === 11) {
    const cpfDigit = (length: number) => {
      const sum = digits.slice(0, length).split("").reduce(
        (total, digit, index) => total + Number(digit) * (length + 1 - index),
        0,
      );
      const remainder = (sum * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };
    return cpfDigit(9) === Number(digits[9]) && cpfDigit(10) === Number(digits[10]);
  }

  if (digits.length === 14) {
    const calculate = (length: number) => {
      const weights = length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const sum = digits.slice(0, length).split("").reduce(
        (total, digit, index) => total + Number(digit) * weights[index],
        0,
      );
      const remainder = sum % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    };
    return calculate(12) === Number(digits[12]) && calculate(13) === Number(digits[13]);
  }

  return false;
}

export function isValidNcm(value: string): boolean {
  return /^\d{8}$/.test(value);
}

export function isValidOrigin(value: string): boolean {
  return /^[0-8]$/.test(value);
}

export function isValidCest(value: string | null | undefined): boolean {
  return value == null || value === "" || /^\d{7}$/.test(value);
}

export function isValidAccessKey(value: string): boolean {
  if (!/^\d{44}$/.test(value)) return false;
  let sum = 0;
  let weight = 2;
  for (let index = 42; index >= 0; index--) {
    sum += Number(value[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const checkDigit = remainder < 2 ? 0 : 11 - remainder;
  return checkDigit === Number(value[43]);
}

export function getFiscalMode(): "manual" | "nfeio" {
  const mode = process.env["FISCAL_MODE"]?.trim().toLowerCase() || "manual";
  if (mode !== "manual" && mode !== "nfeio") {
    throw new Error("FISCAL_MODE must be either 'manual' or 'nfeio'.");
  }
  return mode;
}
