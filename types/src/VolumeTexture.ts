/** Dense KTX2 volume data: x-fastest voxels in native texture coordinate order. */
export interface VolumeTextureData {
  width: number;
  height: number;
  depth: number;
  channels: 1 | 4;
  data: Uint8Array;
}

export const MAX_VOLUME_BYTES = 256 * 1024 * 1024;

function validateDataFormat(bytes: Uint8Array, header: DataView, dfd: number, dfdLength: number, channels: 1 | 4): void {
  if (dfdLength < 28 + channels * 16 || header.getUint32(dfd, true) !== dfdLength ||
    header.getUint32(dfd + 4, true) !== 0 || header.getUint16(dfd + 8, true) !== 2 ||
    header.getUint16(dfd + 10, true) !== dfdLength - 4 || bytes[dfd + 12] !== 1 ||
    bytes[dfd + 14] !== 1 || bytes[dfd + 20] !== channels ||
    bytes.slice(dfd + 16, dfd + 20).some(value => value !== 0)) {
    throw new Error("Invalid or unsupported KTX2 data format descriptor (requires linear R8/RGBA8)");
  }
}

function validateMetadata(bytes: Uint8Array, u32: (offset: number) => number, kvd: number, kvdLength: number, section: (offset: number, length: number, name: string) => void): void {
  if (kvdLength) {
    section(kvd, kvdLength, "metadata");
    let cursor = kvd;
    while (cursor < kvd + kvdLength) {
      if (cursor + 4 > kvd + kvdLength) {
        throw new Error("Truncated KTX2 metadata entry");
      }
      const length = u32(cursor); cursor += 4;
      if (!length || cursor + length > kvd + kvdLength) {
        throw new Error("Invalid KTX2 metadata entry size");
      }
      const entry = bytes.subarray(cursor, cursor + length);
      const separator = entry.indexOf(0);
      if (separator < 1) {
        throw new Error("Invalid KTX2 metadata key");
      }
      const key = String.fromCharCode(...entry.subarray(0, Math.min(separator, 64)));
      if (key === "KTXswizzle") {
        const swizzle = String.fromCharCode(...entry.subarray(separator + 1, separator + 5));
        if (swizzle !== "rgba") {
          throw new Error("KTX2 volume channel swizzles are not supported");
        }
      }
      // KTXorientation describes logical axes; it does not change byte-to-texture mapping.
      cursor += Math.ceil(length / 4) * 4;
    }
    if (cursor !== kvd + kvdLength) {
      throw new Error("Truncated KTX2 metadata padding");
    }
  } else if (kvd !== 0) {
    throw new Error("Invalid KTX2 empty metadata offset");
  }
}

function validateShape(u32: (offset: number) => number, width: number, height: number, depth: number): void {
  if (u32(16) !== 1) {
    throw new Error("KTX2 volume typeSize must be 1");
  }
  if (!width || !height || !depth) {
    throw new Error("KTX2 requires non-zero 3D volume dimensions");
  }
  if (u32(32) !== 0 || u32(36) !== 1) {
    throw new Error("KTX2 volume arrays and cubemaps are not supported");
  }
  if (u32(44) !== 0) {
    throw new Error("Supercompressed KTX2 volumes are not supported; export uncompressed KTX2");
  }
}

/** Decode dense KTX2 3D textures. Only linear, uncompressed R8/RGBA8 are supported. */
export function decodeVolumeTexture(buffer: ArrayBuffer): VolumeTextureData {
  if (buffer.byteLength < 104) {
    throw new Error("KTX2 volume header is truncated");
  }
  const bytes = new Uint8Array(buffer);
  const identifier = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  if (identifier.some((value, i) => bytes[i] !== value)) {
    throw new Error("Expected a KTX2 volume file");
  }
  const header = new DataView(buffer);
  const u32 = (offset: number) => header.getUint32(offset, true);
  const u64 = (offset: number) => {
    const value = header.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("KTX2 offset exceeds safe integer range");
    }
    return Number(value);
  };
  const format = u32(12);
  if (format !== 9 && format !== 37) {
    throw new Error("KTX2 volume format must be R8_UNORM or R8G8B8A8_UNORM");
  }
  const channels = format === 9 ? 1 : 4;
  const width = u32(20), height = u32(24), depth = u32(28);
  validateShape(u32, width, height, depth);
  if (width * height * depth * 4 > MAX_VOLUME_BYTES) {
    throw new Error("Volume exceeds the 256 MiB input limit");
  }
  const levels = Math.max(1, u32(40));
  if (levels > Math.floor(Math.log2(Math.max(width, height, depth))) + 1) {
    throw new Error("Invalid KTX2 mip level count");
  }
  const indexEnd = 80 + levels * 24;
  if (indexEnd > buffer.byteLength) {
    throw new Error("KTX2 level index is truncated");
  }
  const ranges: Array<[number, number]> = [[0, indexEnd]];
  const section = (offset: number, length: number, name: string, alignment = 4) => {
    if (!Number.isSafeInteger(offset + length) || !length || offset % alignment !== 0 || offset < indexEnd || offset + length > buffer.byteLength) {
      throw new Error(`Invalid KTX2 ${name} byte range`);
    }
    if (ranges.some(([start, end]) => offset < end && offset + length > start)) {
      throw new Error(`Overlapping KTX2 ${name}`);
    }
    ranges.push([offset, offset + length]);
  };
  const dfd = u32(48), dfdLength = u32(52);
  section(dfd, dfdLength, "data format descriptor");
  validateDataFormat(bytes, header, dfd, dfdLength, channels);
  const kvd = u32(56), kvdLength = u32(60);
  validateMetadata(bytes, u32, kvd, kvdLength, section);
  if (u64(64) !== 0 || u64(72) !== 0) {
    throw new Error("Unexpected KTX2 supercompression global data");
  }
  let data = new Uint8Array(0);
  for (let level = 0; level < levels; level++) {
    const entry = 80 + level * 24;
    const offset = u64(entry), length = u64(entry + 8), uncompressed = u64(entry + 16);
    const expected = Math.max(1, Math.floor(width / 2 ** level)) * Math.max(1, Math.floor(height / 2 ** level)) * Math.max(1, Math.floor(depth / 2 ** level)) * channels;
    if (length !== expected || uncompressed !== expected) {
      throw new Error("KTX2 volume level byte count mismatch");
    }
    section(offset, length, "mip level");
    if (level === 0) {
      data = bytes.subarray(offset, offset + length);
    }
  }
  return { width, height, depth, channels, data };
}

/** GPU uploads use red-only R8 semantics, with no image-style Y flip. */
export function volumeRgba(volume: VolumeTextureData): Uint8Array {
  if (volume.channels === 4) {
    return volume.data;
  }
  const rgba = new Uint8Array(volume.data.length * 4);
  for (let i = 0; i < volume.data.length; i++) {
    rgba[i * 4] = volume.data[i];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export function volumeSlice(volume: VolumeTextureData, axis: "x" | "y" | "z", slice: number): { width: number; height: number; data: Uint8Array } {
  const size = axis === "x" ? volume.width : axis === "y" ? volume.height : volume.depth;
  if (!Number.isInteger(slice) || slice < 0 || slice >= size) {
    throw new Error("Volume slice is out of range");
  }
  const width = axis === "x" ? volume.depth : volume.width;
  const height = axis === "y" ? volume.depth : volume.height;
  const data = new Uint8Array(width * height * 4);
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const x = axis === "x" ? slice : u;
      const y = axis === "y" ? slice : v;
      const z = axis === "z" ? slice : axis === "x" ? u : v;
      const source = ((z * volume.height + y) * volume.width + x) * volume.channels;
      const dest = (v * width + u) * 4;
      for (let c = 0; c < 3; c++) {
        data[dest + c] = volume.data[source + (volume.channels === 1 ? 0 : c)];
      }
      data[dest + 3] = volume.channels === 1 ? 255 : volume.data[source + 3];
    }
  }
  return { width, height, data };
}
