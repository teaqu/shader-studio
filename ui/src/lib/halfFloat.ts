const scratch = new DataView(new ArrayBuffer(4));

export function halfToFloat(bits: number): number {
  const sign = (bits & 0x8000) ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) {
    return sign * 2 ** -14 * (fraction / 1024);
  }
  if (exponent === 31) {
    return fraction ? Number.NaN : sign * Infinity;
  }
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

/** Converts f32 to IEEE-754 binary16 using round-to-nearest, ties-to-even. */
export function floatToHalf(value: number): number {
  scratch.setFloat32(0, value, false);
  const bits = scratch.getUint32(0, false);
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  const fraction = bits & 0x7fffff;
  if (exponent === 0xff) {
    return sign | (fraction ? 0x7e00 : 0x7c00);
  }
  let halfExponent = exponent - 112;
  if (halfExponent >= 31) {
    return sign | 0x7c00;
  }
  if (halfExponent <= 0) {
    if (halfExponent < -10) {
      return sign;
    }
    const rounded = roundToEven(fraction | 0x800000, 14 - halfExponent);
    return sign | rounded;
  }
  const roundedFraction = roundToEven(fraction, 13);
  if (roundedFraction === 0x400) {
    halfExponent++;
    if (halfExponent >= 31) {
      return sign | 0x7c00;
    }
    return sign | (halfExponent << 10);
  }
  return sign | (halfExponent << 10) | roundedFraction;
}

function roundToEven(value: number, shift: number): number {
  const rounded = value >>> shift;
  const remainder = value & ((1 << shift) - 1);
  const half = 1 << (shift - 1);
  return remainder > half || (remainder === half && (rounded & 1) !== 0) ? rounded + 1 : rounded;
}
