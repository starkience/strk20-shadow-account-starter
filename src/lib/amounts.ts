export function parseUnits(value: string, decimals: number): bigint {
  assertUnitPrecision(decimals, "decimals");
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function formatUnits(value: bigint, decimals: number, precision = 4): string {
  assertUnitPrecision(decimals, "decimals");
  assertUnitPrecision(precision, "precision");
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0").slice(0, precision);
  const suffix = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${suffix ? `.${suffix}` : ""}`;
}

function assertUnitPrecision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label} must be an integer between 0 and 255`);
  }
}
