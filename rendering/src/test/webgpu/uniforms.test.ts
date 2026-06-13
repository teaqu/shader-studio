import { describe, it, expect } from "vitest";
import { packShaderToyUniforms } from "../../webgpu/uniforms";
import { SHADERTOY_UNIFORM_SIZE, UNIFORM_OFFSETS } from "../../webgpu/SlangPrelude";

describe("packShaderToyUniforms", () => {
  const input = {
    width: 800,
    height: 600,
    time: 1.5,
    timeDelta: 0.016,
    frameRate: 60,
    frame: 42,
    mouse: [10, 20, -10, -20],
  };

  it("produces a buffer of the declared size", () => {
    expect(packShaderToyUniforms(input).byteLength).toBe(SHADERTOY_UNIFORM_SIZE);
  });

  it("writes each field at its std140 offset", () => {
    const buf = packShaderToyUniforms(input);
    const dv = new DataView(buf);
    const f = (off: number) => dv.getFloat32(off, true);
    const i = (off: number) => dv.getInt32(off, true);

    expect(f(UNIFORM_OFFSETS.iResolution)).toBe(800);
    expect(f(UNIFORM_OFFSETS.iResolution + 4)).toBe(600);
    expect(f(UNIFORM_OFFSETS.iResolution + 8)).toBe(1); // pixel aspect

    expect(f(UNIFORM_OFFSETS.iMouse)).toBe(10);
    expect(f(UNIFORM_OFFSETS.iMouse + 4)).toBe(20);
    expect(f(UNIFORM_OFFSETS.iMouse + 8)).toBe(-10);
    expect(f(UNIFORM_OFFSETS.iMouse + 12)).toBe(-20);

    expect(f(UNIFORM_OFFSETS.iTime)).toBeCloseTo(1.5);
    expect(f(UNIFORM_OFFSETS.iTimeDelta)).toBeCloseTo(0.016);
    expect(f(UNIFORM_OFFSETS.iFrameRate)).toBe(60);
    expect(i(UNIFORM_OFFSETS.iFrame)).toBe(42);
  });

  it("defaults missing mouse components to zero", () => {
    const buf = packShaderToyUniforms({ ...input, mouse: [5] });
    const dv = new DataView(buf);
    expect(dv.getFloat32(UNIFORM_OFFSETS.iMouse, true)).toBe(5);
    expect(dv.getFloat32(UNIFORM_OFFSETS.iMouse + 4, true)).toBe(0);
  });
});
