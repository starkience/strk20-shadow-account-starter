import { describe, expect, it } from 'vitest';
import { decodeUint256, formatTokenAmount, parseTokenAmount } from './amounts';

describe('token amounts', () => {
  it('parses without routing through Number', () => {
    expect(parseTokenAmount('1.25', 18)).toBe(1_250_000_000_000_000_000n);
    expect(parseTokenAmount('9007199254740993', 0)).toBe(9_007_199_254_740_993n);
  });

  it('rejects signs, exponents, zero, and excessive precision', () => {
    for (const value of ['-1', '+1', '1e3', '0', '0.0000000000000000001']) {
      expect(() => parseTokenAmount(value, 18)).toThrow();
    }
  });

  it('formats and decodes values exactly', () => {
    expect(formatTokenAmount(1_234_560_000_000_000_000n, 18)).toBe('1.2345');
    expect(decodeUint256(['0x1', '0x1'])).toBe((1n << 128n) + 1n);
  });
});
