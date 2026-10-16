/** Test-only KTX2 writer with a Khronos basic RGBSDA descriptor. */
export function ktxVolume(width = 2, height = 3, depth = 4, channels: 1 | 4 = 1, data?: Uint8Array): ArrayBuffer {
  const dfdSize = 28 + channels * 16;
  const offset = 104 + dfdSize;
  const payload = data ?? Uint8Array.from({ length: width * height * depth * channels }, (_, i) => i);
  const buffer = new ArrayBuffer(offset + payload.length);
  const bytes = new Uint8Array(buffer);
  bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  const h = new DataView(buffer);
  [channels === 1 ? 9 : 37, 1, width, height, depth, 0, 1, 1, 0, 104, dfdSize].forEach((value, i) => h.setUint32(12 + i * 4, value, true));
  h.setBigUint64(80, BigInt(offset), true); h.setBigUint64(88, BigInt(payload.length), true); h.setBigUint64(96, BigInt(payload.length), true);
  h.setUint32(104, dfdSize, true);
  h.setUint16(112, 2, true); h.setUint16(114, dfdSize - 4, true);
  bytes.set([1, 1, 1, 0], 116); bytes[124] = channels;
  for (let c = 0; c < channels; c++) {
    const sample = 132 + c * 16;
    h.setUint16(sample, c * 8, true); bytes[sample + 2] = 7; bytes[sample + 3] = c === 3 ? 15 : c;
    h.setUint32(sample + 12, 255, true);
  }
  bytes.set(payload, offset);
  return buffer;
}
