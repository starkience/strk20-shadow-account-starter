export function parseTokenAmount(value: string, decimals: number): bigint {
  const input = value.trim();
  if (!/^\d+(?:\.\d*)?$/.test(input)) {
    throw new Error('Enter a positive decimal amount without signs or exponents.');
  }
  const [whole = '0', fraction = ''] = input.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Use at most ${decimals} decimal places.`);
  }
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  if (units <= 0n) throw new Error('Enter an amount greater than zero.');
  return units;
}

export function formatTokenAmount(value: bigint, decimals: number, precision = 4): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').slice(0, precision);
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

export function decodeUint256(values: readonly string[]): bigint {
  const low = BigInt(values[0] ?? 0);
  const high = BigInt(values[1] ?? 0);
  return low + (high << 128n);
}
