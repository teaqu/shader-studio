import { describe, expect, it } from "vitest";
import { CaptureDecoder } from "../capture/CaptureDecoder";

describe("CaptureDecoder.decodePixel", () => {
  const rgba = new Float32Array([0.1, 0.2, 0.3, 0.4]);

  it("should return [R] for float", () => {
    const result = CaptureDecoder.decodePixel(rgba, "float");
    expect(result).toHaveLength(1);
    expect(result[0]).toBeCloseTo(0.1);
  });

  it("should return [R] for int", () => {
    const result = CaptureDecoder.decodePixel(rgba, "int");
    expect(result).toHaveLength(1);
    expect(result[0]).toBeCloseTo(0.1);
  });

  it("should return [R] for bool", () => {
    const result = CaptureDecoder.decodePixel(rgba, "bool");
    expect(result).toHaveLength(1);
    expect(result[0]).toBeCloseTo(0.1);
  });

  it("should return [R, G] for vec2", () => {
    const result = CaptureDecoder.decodePixel(rgba, "vec2");
    expect(result).toHaveLength(2);
    expect(result[0]).toBeCloseTo(0.1);
    expect(result[1]).toBeCloseTo(0.2);
  });

  it("should return [R, G, B] for vec3", () => {
    const result = CaptureDecoder.decodePixel(rgba, "vec3");
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(0.1);
    expect(result[1]).toBeCloseTo(0.2);
    expect(result[2]).toBeCloseTo(0.3);
  });

  it("should return [R, G, B, A] for vec4", () => {
    const result = CaptureDecoder.decodePixel(rgba, "vec4");
    expect(result).toHaveLength(4);
    expect(result[3]).toBeCloseTo(0.4);
  });

  it("should return [R, G, B, A] for mat2 (4 components packed into RGBA)", () => {
    const result = CaptureDecoder.decodePixel(rgba, "mat2");
    expect(result).toHaveLength(4);
    expect(result[0]).toBeCloseTo(0.1); // col0.x
    expect(result[1]).toBeCloseTo(0.2); // col0.y
    expect(result[2]).toBeCloseTo(0.3); // col1.x
    expect(result[3]).toBeCloseTo(0.4); // col1.y
  });

  it("should fallback to [R] for unknown type", () => {
    const result = CaptureDecoder.decodePixel(rgba, "mat4");
    expect(result).toHaveLength(1);
    expect(result[0]).toBeCloseTo(0.1);
  });
});

describe("CaptureDecoder.extractComponentGrid", () => {
  it("should extract correct channel across all pixels", () => {
    // 4 pixels, RGBA each: [R0,G0,B0,A0, R1,G1,B1,A1, R2,G2,B2,A2, R3,G3,B3,A3]
    const pixelData = new Float32Array([
      1.0, 0.1, 0.2, 0.3,
      2.0, 0.4, 0.5, 0.6,
      3.0, 0.7, 0.8, 0.9,
      4.0, 1.0, 1.1, 1.2,
    ]);
    const result = CaptureDecoder.extractComponentGrid(pixelData, 2, 0); // R channel
    expect(result[0]).toBeCloseTo(1.0);
    expect(result[1]).toBeCloseTo(2.0);
    expect(result[2]).toBeCloseTo(3.0);
    expect(result[3]).toBeCloseTo(4.0);
  });

  it("should extract G channel", () => {
    const single = new Float32Array([5.0, 10.0, 15.0, 20.0]);
    const gResult = CaptureDecoder.extractComponentGrid(single, 1, 1); // G channel of 1x1 grid
    expect(gResult[0]).toBeCloseTo(10.0);
  });

  it("should extract from non-square grid using gridHeight parameter", () => {
    // 3 wide × 2 tall = 6 pixels
    const pixelData = new Float32Array([
      1.0, 0.0, 0.0, 0.0,  // (0,0)
      2.0, 0.0, 0.0, 0.0,  // (1,0)
      3.0, 0.0, 0.0, 0.0,  // (2,0)
      4.0, 0.0, 0.0, 0.0,  // (0,1)
      5.0, 0.0, 0.0, 0.0,  // (1,1)
      6.0, 0.0, 0.0, 0.0,  // (2,1)
    ]);
    const result = CaptureDecoder.extractComponentGrid(pixelData, 3, 0, 2); // R channel, 3×2
    expect(result).toHaveLength(6);
    expect(result[0]).toBeCloseTo(1.0);
    expect(result[5]).toBeCloseTo(6.0);
  });

  it("should extract from tall non-square grid", () => {
    // 2 wide × 3 tall = 6 pixels
    const pixelData = new Float32Array([
      0.0, 10.0, 0.0, 0.0,
      0.0, 20.0, 0.0, 0.0,
      0.0, 30.0, 0.0, 0.0,
      0.0, 40.0, 0.0, 0.0,
      0.0, 50.0, 0.0, 0.0,
      0.0, 60.0, 0.0, 0.0,
    ]);
    const result = CaptureDecoder.extractComponentGrid(pixelData, 2, 1, 3); // G channel, 2×3
    expect(result).toHaveLength(6);
    expect(result[0]).toBeCloseTo(10.0);
    expect(result[5]).toBeCloseTo(60.0);
  });

  it("should handle single-row grid (width×1)", () => {
    const pixelData = new Float32Array([
      7.0, 0.0, 0.0, 0.0,
      8.0, 0.0, 0.0, 0.0,
      9.0, 0.0, 0.0, 0.0,
    ]);
    const result = CaptureDecoder.extractComponentGrid(pixelData, 3, 0, 1);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(7.0);
    expect(result[2]).toBeCloseTo(9.0);
  });

  it("legacy square call without gridHeight still works", () => {
    // 2×2 grid = 4 pixels
    const pixelData = new Float32Array([
      1.0, 0.0, 0.0, 0.0,
      2.0, 0.0, 0.0, 0.0,
      3.0, 0.0, 0.0, 0.0,
      4.0, 0.0, 0.0, 0.0,
    ]);
    const result = CaptureDecoder.extractComponentGrid(pixelData, 2, 0);
    expect(result).toHaveLength(4);
  });
});

describe("CaptureDecoder.computeStats", () => {
  it("should compute min, max, mean correctly", () => {
    const values = new Float32Array([1, 2, 3]);
    const stats = CaptureDecoder.computeStats(values);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(3);
    expect(stats.mean).toBe(2);
  });

  it("should handle single value", () => {
    const values = new Float32Array([5]);
    const stats = CaptureDecoder.computeStats(values);
    expect(stats.min).toBe(5);
    expect(stats.max).toBe(5);
    expect(stats.mean).toBe(5);
  });

  it("should handle empty array", () => {
    const stats = CaptureDecoder.computeStats(new Float32Array([]));
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(0);
    expect(stats.mean).toBe(0);
  });

  it("should handle negative values", () => {
    const values = new Float32Array([-1, 0, 1]);
    const stats = CaptureDecoder.computeStats(values);
    expect(stats.min).toBe(-1);
    expect(stats.max).toBe(1);
    expect(stats.mean).toBeCloseTo(0);
  });
});

describe("CaptureDecoder.buildHistogram", () => {
  it("should produce correct number of bins", () => {
    const values = new Float32Array([0, 0.25, 0.5, 0.75, 1.0]);
    const { bins } = CaptureDecoder.buildHistogram(values, 4);
    expect(bins).toHaveLength(4);
  });

  it("should cover all values", () => {
    const values = new Float32Array([0, 0.1, 0.5, 0.9, 1.0]);
    const { bins } = CaptureDecoder.buildHistogram(values, 5);
    const total = bins.reduce((a, b) => a + b, 0);
    expect(total).toBe(values.length);
  });

  it("should put all values in middle bin when all equal", () => {
    const values = new Float32Array([0.5, 0.5, 0.5]);
    const { bins } = CaptureDecoder.buildHistogram(values, 4);
    const totalFilled = bins.filter(b => b > 0).length;
    expect(totalFilled).toBe(1);
    expect(bins.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("should return correct min and max in histogram", () => {
    const values = new Float32Array([-1, 0, 1]);
    const { min, max } = CaptureDecoder.buildHistogram(values, 10);
    expect(min).toBe(-1);
    expect(max).toBe(1);
  });
});
