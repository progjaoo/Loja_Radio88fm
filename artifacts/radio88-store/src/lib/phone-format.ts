export function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  const hasBrazilCountryCode =
    value.trimStart().startsWith("+55") || (digits.length > 11 && digits.startsWith("55"));
  return (hasBrazilCountryCode ? digits.slice(2) : digits).slice(0, 11);
}

export function formatBrazilPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const hasBrazilCountryCode =
    value.trimStart().startsWith("+55") || (digits.length > 11 && digits.startsWith("55"));
  const nationalNumber = (hasBrazilCountryCode ? digits.slice(2) : digits).slice(0, 11);
  if (!nationalNumber) return hasBrazilCountryCode ? "+55" : "";

  const countryPrefix = hasBrazilCountryCode ? "+55 " : "";
  const areaCode = nationalNumber.slice(0, 2);
  const subscriber = nationalNumber.slice(2);
  if (areaCode.length < 2) return `${countryPrefix}(${areaCode}`;

  const subscriberPrefixLength = nationalNumber.length > 10 ? 5 : 4;
  const formattedSubscriber = subscriber.length > subscriberPrefixLength
    ? `${subscriber.slice(0, subscriberPrefixLength)}-${subscriber.slice(subscriberPrefixLength)}`
    : subscriber;

  return `${countryPrefix}(${areaCode})${subscriber ? ` ${formattedSubscriber}` : ""}`;
}
