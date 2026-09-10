import { describe, expect, it } from 'vitest';
import { floatToHalf, halfToFloat } from '../lib/halfFloat';

describe('binary16 conversion', () => {
  it.each([
    [-0, 0x8000], [Infinity, 0x7c00], [-Infinity, 0xfc00], [2 ** -24, 0x0001], [65504, 0x7bff],
    [1.9999, 0x4000], [65520, 0x7c00], [2 ** -25, 0], [3 * 2 ** -25, 0x0002],
  ])('encodes %s as 0x%s', (value, bits) => {
    expect(floatToHalf(value)).toBe(bits);
  });

  it('round-trips every finite binary16 value, including signed zero and subnormals', () => {
    for (let bits = 0; bits <= 0xffff; bits++) {
      if ((bits & 0x7c00) !== 0x7c00) {
        expect(floatToHalf(halfToFloat(bits))).toBe(bits);
      }
    }
    expect(Object.is(halfToFloat(0x8000), -0)).toBe(true);
  });

  it('preserves NaN and rounds ties to even', () => {
    expect(Number.isNaN(halfToFloat(floatToHalf(Number.NaN)))).toBe(true);
    expect(floatToHalf(1 + 2 ** -11)).toBe(0x3c00);
    expect(floatToHalf(1 + 3 * 2 ** -11)).toBe(0x3c02);
  });
});
