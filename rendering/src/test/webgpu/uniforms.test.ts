import { describe, it, expect } from "vitest";
import { createSlangCustomUniformLayout, packShaderToyUniforms } from "../../webgpu/uniforms";
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
    channelTime: Object.assign(new Array(16).fill(0), { 0: 1.25, 2: 3.5, 15: 9.75 }),
    channelLoaded: Object.assign(new Array(16).fill(0), { 0: 1, 2: 1, 15: 1 }),
    sampleRate: 48000,
    date: [2026, 7, 19, 45296],
    channelResolution: Object.assign(new Array(48).fill(0), {
      0: 512, 1: 2, 2: 1, 6: 1920, 7: 1080, 8: 1, 9: 256, 10: 3, 11: 1,
      45: 4096, 46: 2048, 47: 1,
    }),
    cameraPos: [1, 2, 3],
    cameraDir: [0.25, 0.5, -0.75],
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
    expect(f(UNIFORM_OFFSETS.iResolution + 8)).toBeCloseTo(800 / 600);

    expect(f(UNIFORM_OFFSETS.iMouse)).toBe(10);
    expect(f(UNIFORM_OFFSETS.iMouse + 4)).toBe(20);
    expect(f(UNIFORM_OFFSETS.iMouse + 8)).toBe(-10);
    expect(f(UNIFORM_OFFSETS.iMouse + 12)).toBe(-20);

    expect(f(UNIFORM_OFFSETS.iTime)).toBeCloseTo(1.5);
    expect(f(UNIFORM_OFFSETS.iTimeDelta)).toBeCloseTo(0.016);
    expect(f(UNIFORM_OFFSETS.iFrameRate)).toBe(60);
    expect(i(UNIFORM_OFFSETS.iFrame)).toBe(42);

    expect(f(UNIFORM_OFFSETS.iChannelTime)).toBeCloseTo(1.25);
    expect(f(UNIFORM_OFFSETS.iChannelTime + 16)).toBe(0);
    expect(f(UNIFORM_OFFSETS.iChannelTime + 32)).toBeCloseTo(3.5);
    expect(f(UNIFORM_OFFSETS.iChannelTime + 15 * 16)).toBeCloseTo(9.75);

    expect(f(UNIFORM_OFFSETS.iChannelLoaded)).toBe(1);
    expect(f(UNIFORM_OFFSETS.iChannelLoaded + 16)).toBe(0);
    expect(f(UNIFORM_OFFSETS.iChannelLoaded + 32)).toBe(1);
    expect(f(UNIFORM_OFFSETS.iChannelLoaded + 15 * 16)).toBe(1);
    expect(f(UNIFORM_OFFSETS.iSampleRate)).toBe(48000);

    expect(f(UNIFORM_OFFSETS.iDate)).toBe(2026);
    expect(f(UNIFORM_OFFSETS.iDate + 12)).toBe(45296);
    expect(f(UNIFORM_OFFSETS.iChannelResolution)).toBe(512);
    expect(f(UNIFORM_OFFSETS.iChannelResolution + 4)).toBe(2);
    expect(f(UNIFORM_OFFSETS.iChannelResolution + 16 + 8)).toBe(0);
    expect(f(UNIFORM_OFFSETS.iChannelResolution + 32)).toBe(1920);
    expect(f(UNIFORM_OFFSETS.iChannelResolution + 48 + 4)).toBe(3);
    expect(f(UNIFORM_OFFSETS.iChannelResolution + 15 * 16)).toBe(4096);
    expect(f(UNIFORM_OFFSETS.iChannelResolution + 15 * 16 + 4)).toBe(2048);

    expect(f(UNIFORM_OFFSETS.iCameraPos)).toBe(1);
    expect(f(UNIFORM_OFFSETS.iCameraPos + 4)).toBe(2);
    expect(f(UNIFORM_OFFSETS.iCameraPos + 8)).toBe(3);
    expect(f(UNIFORM_OFFSETS.iCameraDir)).toBe(0.25);
    expect(f(UNIFORM_OFFSETS.iCameraDir + 4)).toBe(0.5);
    expect(f(UNIFORM_OFFSETS.iCameraDir + 8)).toBe(-0.75);
  });

  it("defaults missing mouse components to zero", () => {
    const buf = packShaderToyUniforms({ ...input, mouse: [5] });
    const dv = new DataView(buf);
    expect(dv.getFloat32(UNIFORM_OFFSETS.iMouse, true)).toBe(5);
    expect(dv.getFloat32(UNIFORM_OFFSETS.iMouse + 4, true)).toBe(0);
  });

  it("aligns and packs every supported custom type while ignoring unsupported types", () => {
    const info = [
      { name: "gain", type: "float" },
      { name: "offset", type: "vec2" },
      { name: "normal", type: "vec3" },
      { name: "tint", type: "vec4" },
      { name: "enabled", type: "bool" },
      { name: "ignored", type: "mat4" },
    ];
    const layout = createSlangCustomUniformLayout(info);
    expect(layout).toEqual({
      entries: [
        { name: "gain", type: "float", offset: 880 },
        { name: "offset", type: "vec2", offset: 888 },
        { name: "normal", type: "vec3", offset: 896 },
        { name: "tint", type: "vec4", offset: 912 },
        { name: "enabled", type: "bool", offset: 928 },
      ],
      size: 944,
    });

    const buffer = packShaderToyUniforms(input, info, [
      { name: "gain", type: "float", value: 0.25 },
      { name: "offset", type: "vec2", value: [1, 2] },
      { name: "normal", type: "vec3", value: [3, 4, 5] },
      { name: "tint", type: "vec4", value: [6, 7, 8, 9] },
      { name: "enabled", type: "bool", value: true },
      { name: "ignored", type: "mat4", value: [] },
    ]);
    const view = new DataView(buffer);
    expect(buffer.byteLength).toBe(944);
    expect(view.getFloat32(880, true)).toBeCloseTo(0.25);
    expect([view.getFloat32(888, true), view.getFloat32(892, true)]).toEqual([1, 2]);
    expect([view.getFloat32(896, true), view.getFloat32(900, true), view.getFloat32(904, true)])
      .toEqual([3, 4, 5]);
    expect(view.getFloat32(924, true)).toBe(9);
    expect(view.getInt32(928, true)).toBe(1);
  });

  it("zero-fills custom values that have not arrived yet", () => {
    const buffer = packShaderToyUniforms(input, [
      { name: "offset", type: "vec2" },
      { name: "enabled", type: "bool" },
    ]);
    const view = new DataView(buffer);
    expect(view.getFloat32(880, true)).toBe(0);
    expect(view.getFloat32(884, true)).toBe(0);
    expect(view.getInt32(888, true)).toBe(0);
  });
});
