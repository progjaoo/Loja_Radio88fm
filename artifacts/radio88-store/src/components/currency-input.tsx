import { formatCents, parseCents } from "@/lib/currency";

type CurrencyInputProps = {
  value: number;
  onChange: (cents: number) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "data-testid"?: string;
};

export function CurrencyInput({
  value,
  onChange,
  label = "Preço em reais",
  id,
  disabled = false,
  required = false,
  className = "field mt-1.5",
  "data-testid": testId,
}: CurrencyInputProps) {
  return (
    <input
      id={id}
      className={className}
      aria-label={label}
      data-testid={testId}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      value={formatCents(value)}
      onChange={(event) => onChange(parseCents(event.currentTarget.value))}
      disabled={disabled}
      required={required}
    />
  );
}
