import { describe, it, expect } from "vitest";
import { decodeVolumeTexture, volumeRgba, volumeSlice } from "./VolumeTexture";
import { resolveGlslInputBindings } from "./GlslShaderEnvironment";

import { ktxVolume as asset } from "../test/ktxVolume";

describe("volume assets", () => {
  it.each([1, 4] as const)("decodes non-cubic %i-channel dimensions and x-fastest data without flipping", channels => {
    const volume = decodeVolumeTexture(asset(2, 3, 4, channels));
    expect(volume).toMatchObject({ width: 2, height: 3, depth: 4, channels });
    expect(volume.data[(3 * 6 + 2 * 2 + 1) * channels]).toBe(23 * channels);
    const rgba = volumeRgba(volume);
    expect(rgba.length).toBe(96);
    expect(Array.from(rgba.slice(0, 8))).toEqual(channels === 1 ? [0, 0, 0, 255, 1, 0, 0, 255] : [0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it.each([
    ["magic", 0, 0], ["width", 20, 0], ["height", 24, 0], ["depth", 28, 0],
    ["format", 12, 100], ["type size", 16, 2], ["array", 32, 1], ["cube", 36, 6],
    ["compression", 44, 2], ["size limit", 20, 0xffffffff], ["mip count", 40, 50],
    ["DFD offset", 48, 0], ["DFD size", 52, 4],
  ])("rejects invalid %s", (_name, offset, value) => {
    const buffer = asset();
    new DataView(buffer).setUint32(offset as number, value as number, true);
    expect(() => decodeVolumeTexture(buffer)).toThrow();
  });
  it("rejects legacy BIN, truncated headers, truncated payloads and unsafe level offsets", () => {
    expect(() => decodeVolumeTexture(new ArrayBuffer(19))).toThrow("header");
    expect(() => decodeVolumeTexture(asset().slice(0, -1))).toThrow();
    const legacy = new ArrayBuffer(104); new DataView(legacy).setUint32(0, 0x0a4e4942, true);
    expect(() => decodeVolumeTexture(legacy)).toThrow("KTX2");
    const buffer = asset(); new DataView(buffer).setBigUint64(80, 2n ** 63n, true);
    expect(() => decodeVolumeTexture(buffer)).toThrow();
  });
  it("accepts levelCount zero and ignores harmless trailing metadata padding", () => {
    const buffer = asset(); new DataView(buffer).setUint32(40, 0, true);
    expect(decodeVolumeTexture(buffer).depth).toBe(4);
    const padded = new Uint8Array(buffer.byteLength + 4); padded.set(new Uint8Array(buffer));
    expect(decodeVolumeTexture(padded.buffer).data).toEqual(decodeVolumeTexture(buffer).data);
  });
  it("reads base data from indexed mip chains and rejects overlapping levels", () => {
    const base = asset();
    const bytes = new Uint8Array(200); bytes.set(new Uint8Array(base, 0, 80));
    const h = new DataView(bytes.buffer);
    h.setUint32(40, 2, true); h.setUint32(48, 128, true);
    bytes.set(new Uint8Array(base, 104, 44), 128);
    bytes.set([55, 66], 172); bytes.set(new Uint8Array(base, 148), 176);
    [176n, 24n, 24n, 172n, 2n, 2n].forEach((v, i) => h.setBigUint64(80 + i * 8, v, true));
    expect(decodeVolumeTexture(bytes.buffer).data).toEqual(decodeVolumeTexture(base).data);
    h.setBigUint64(104, 176n, true);
    expect(() => decodeVolumeTexture(bytes.buffer)).toThrow("Overlapping");
  });
  it.each([[80, 104n], [88, 23n], [96, 23n], [64, 104n], [72, 4n]])("rejects malformed 64-bit index field at %i", (offset, value) => {
    const buffer = asset(); new DataView(buffer).setBigUint64(offset, value, true);
    expect(() => decodeVolumeTexture(buffer)).toThrow();
  });
  it.each([104, 108, 112, 114, 116, 118, 120, 124])("rejects invalid format descriptors at %i", offset => {
    const buffer = asset(); new Uint8Array(buffer)[offset] ^= 3;
    expect(() => decodeVolumeTexture(buffer)).toThrow("descriptor");
  });
  function metadata(key: string, value: string) {
    const base = asset();
    const entry = Uint8Array.from(Array.from(key + "\0" + value + "\0", c => c.charCodeAt(0)));
    const length = 4 + Math.ceil(entry.length / 4) * 4;
    const bytes = new Uint8Array(base.byteLength + length); bytes.set(new Uint8Array(base, 0, 148));
    const h = new DataView(bytes.buffer); h.setUint32(56, 148, true); h.setUint32(60, length, true);
    h.setUint32(148, entry.length, true); bytes.set(entry, 152); bytes.set(new Uint8Array(base, 148), 148 + length);
    h.setBigUint64(80, BigInt(148 + length), true);
    return bytes.buffer;
  }
  it("preserves coordinate order for orientation metadata and permits default swizzle", () => {
    expect(decodeVolumeTexture(metadata("KTXorientation", "rdi")).data).toEqual(decodeVolumeTexture(asset()).data);
    expect(decodeVolumeTexture(metadata("KTXswizzle", "rgba")).channels).toBe(1);
    expect(() => decodeVolumeTexture(metadata("KTXswizzle", "rrr1"))).toThrow("swizzles");
  });
  it("rejects broken metadata sections, entries, keys and padding", () => {
    for (const [offset, value] of [[56, 104], [60, 1000], [148, 0], [148, 1000], [60, 3], [60, 25]]) {
      const buffer = metadata("KTXorientation", "rdi"); new DataView(buffer).setUint32(offset, value, true);
      expect(() => decodeVolumeTexture(buffer)).toThrow();
    }
    const buffer = metadata("", "rdi");
    expect(() => decodeVolumeTexture(buffer)).toThrow("key");
    const empty = asset(); new DataView(empty).setUint32(56, 148, true);
    expect(() => decodeVolumeTexture(empty)).toThrow("empty metadata");
  });
  it("previews all axes with documented x-fastest orientation", () => {
    const volume = decodeVolumeTexture(asset());
    const red = (data: Uint8Array) => Array.from(data).filter((_, i) => i % 4 === 0);
    const z = volumeSlice(volume, "z", 2);
    expect([z.width, z.height]).toEqual([2, 3]);
    expect(red(z.data)).toEqual([12, 13, 14, 15, 16, 17]);
    expect(red(volumeSlice(volume, "x", 1).data)).toEqual([1, 7, 13, 19, 3, 9, 15, 21, 5, 11, 17, 23]);
    expect(red(volumeSlice(volume, "y", 2).data)).toEqual([4, 5, 10, 11, 16, 17, 22, 23]);
    expect(() => volumeSlice(volume, "z", 4)).toThrow("out of range");
    expect(() => volumeSlice(volume, "z", -1)).toThrow();
    expect(() => volumeSlice(volume, "z", 0.5)).toThrow();
    expect(Array.from(volumeSlice(decodeVolumeTexture(asset(1, 1, 1, 4)), "z", 0).data)).toEqual([0, 1, 2, 3]);
  });
  it("declares configured volumes as sampler3D, including named aliases", () => {
    expect(resolveGlslInputBindings({ density: { type: "volume" } })[0]).toMatchObject({ samplerType: "sampler3D", isCustomName: true });
  });
});
