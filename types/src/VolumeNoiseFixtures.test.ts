import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeVolumeTexture } from "./VolumeTexture";

// Original generated replacements, not copies of Shadertoy's proprietary asset bytes.
describe("bundled 3D noise", () => {
  it.each([["noise-grey", 1], ["noise-rgba", 4]] as const)("provides a 32³ %s texture with uniform random voxel channels", (name, channels) => {
    const bytes = readFileSync(new URL(`../../tests/fixtures/shader-corpus/assets/volume-input/${name}.ktx2`, import.meta.url));
    const data = decodeVolumeTexture(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(data).toMatchObject({ width: 32, height: 32, depth: 32, channels });
    for (let c = 0; c < channels; c++) {
      const samples = Array.from(data.data).filter((_, i) => i % channels === c);
      const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      expect(mean).toBeGreaterThan(125); expect(mean).toBeLessThan(130);
      expect(new Set(samples).size).toBe(256);
      const buckets = Array(16).fill(0);
      samples.forEach(value => buckets[value >> 4]++);
      expect(buckets.every(count => count > 1800 && count < 2300)).toBe(true);
    }
    if (channels === 4) {
      const equalRG = Array.from(data.data).filter((v, i) => i % 4 === 0 && v === data.data[i + 1]).length;
      expect(equalRG).toBeLessThan(250);
      expect(new Set(Array.from(data.data).filter((_, i) => i % 4 === 3)).size).toBe(256);
    }
    expect(createHash("sha256").update(data.data).digest("hex")).toBe(channels === 1 ? "3cd6c2c00ec83880619b2f9718f4514e9d73e675e8d5d8fcdda1d8a083447e2c" : "fca5106100ba298681a925dc1f1feca428cf05812a887823518125f2ceb999cc");
  });
});
