import { describe, it, expect } from "vitest";
import { createSlangCustomUniformLayout, packShaderToyUniforms } from "../../webgpu/uniforms";
import { createShaderToyUniformLayout, SHADERTOY_UNIFORM_SIZE, UNIFORM_OFFSETS } from "../../webgpu/SlangPrelude";

describe("packShaderToyUniforms", () => {
  const input = {
    width: 800,
    height: 600,
    time: 1.5,
    timeDelta: 0.016,
    frameRate: 60,
    frame: 42,
    mouse: [10, 20, -10, -20],
    channelTime: Object.assign(new Array(17).fill(0), { 0: 1.25, 2: 3.5, 15: 9.75, 16: 12.5 }),
    channelLoaded: Object.assign(new Array(17).fill(0), { 0: 1, 2: 1, 15: 1, 16: 1 }),
    sampleRate: 48000,
    date: [2026, 7, 19, 45296],
    channelResolution: Object.assign(new Array(48).fill(0), {
      0: 512, 1: 2, 2: 1, 6: 1920, 7: 1080, 8: 1, 9: 256, 10: 3, 11: 1,
      45: 4096, 46: 2048, 47: 1, 48: 3840, 49: 2160, 50: 1,
    }),
    cameraPos: [1, 2, 3],
    cameraDir: [0.25, 0.5, -0.75],
  };

  it("produces a buffer of the declared size", () => {
    expect(packShaderToyUniforms({ ...input, channelCount: 17 }).byteLength).toBe(createShaderToyUniformLayout(17).size);
  });

  it("writes each field at its std140 offset", () => {
    const layout = createShaderToyUniformLayout(17);
    const { offsets } = layout;
    const buf = packShaderToyUniforms({ ...input, channelCount: 17 });
    const dv = new DataView(buf);
    const f = (off: number) => dv.getFloat32(off, true);
    const i = (off: number) => dv.getInt32(off, true);

    expect(layout.channelCount).toBe(17);
    expect(layout.size).not.toBe(49_264);
    expect(f(offsets.iResolution)).toBe(800);
    expect(f(offsets.iResolution + 4)).toBe(600);
    expect(f(offsets.iResolution + 8)).toBeCloseTo(800 / 600);

    expect(f(offsets.iMouse)).toBe(10);
    expect(f(offsets.iMouse + 4)).toBe(20);
    expect(f(offsets.iMouse + 8)).toBe(-10);
    expect(f(offsets.iMouse + 12)).toBe(-20);

    expect(f(offsets.iTime)).toBeCloseTo(1.5);
    expect(f(offsets.iTimeDelta)).toBeCloseTo(0.016);
    expect(f(offsets.iFrameRate)).toBe(60);
    expect(i(offsets.iFrame)).toBe(42);

    expect(f(offsets.iChannelTime)).toBeCloseTo(1.25);
    expect(f(offsets.iChannelTime + 16)).toBe(0);
    expect(f(offsets.iChannelTime + 32)).toBeCloseTo(3.5);
    expect(f(offsets.iChannelTime + 15 * 16)).toBeCloseTo(9.75);
    expect(f(offsets.iChannelTime + 16 * 16)).toBeCloseTo(12.5);

    expect(f(offsets.iChannelLoaded)).toBe(1);
    expect(f(offsets.iChannelLoaded + 16)).toBe(0);
    expect(f(offsets.iChannelLoaded + 32)).toBe(1);
    expect(f(offsets.iChannelLoaded + 15 * 16)).toBe(1);
    expect(f(offsets.iChannelLoaded + 16 * 16)).toBe(1);
    expect(f(offsets.iSampleRate)).toBe(48000);

    expect(f(offsets.iDate)).toBe(2026);
    expect(f(offsets.iDate + 12)).toBe(45296);
    expect(f(offsets.iChannelResolution)).toBe(512);
    expect(f(offsets.iChannelResolution + 4)).toBe(2);
    expect(f(offsets.iChannelResolution + 16 + 8)).toBe(0);
    expect(f(offsets.iChannelResolution + 32)).toBe(1920);
    expect(f(offsets.iChannelResolution + 48 + 4)).toBe(3);
    expect(f(offsets.iChannelResolution + 15 * 16)).toBe(4096);
    expect(f(offsets.iChannelResolution + 15 * 16 + 4)).toBe(2048);
    expect(f(offsets.iChannelResolution + 16 * 16)).toBe(3840);
    expect(f(offsets.iChannelResolution + 16 * 16 + 4)).toBe(2160);

    expect(f(offsets.iCameraPos)).toBe(1);
    expect(f(offsets.iCameraPos + 4)).toBe(2);
    expect(f(offsets.iCameraPos + 8)).toBe(3);
    expect(f(offsets.iCameraDir)).toBe(0.25);
    expect(f(offsets.iCameraDir + 4)).toBe(0.5);
    expect(f(offsets.iCameraDir + 8)).toBe(-0.75);
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
        { name: "gain", type: "float", offset: SHADERTOY_UNIFORM_SIZE },
        { name: "offset", type: "vec2", offset: SHADERTOY_UNIFORM_SIZE + 8 },
        { name: "normal", type: "vec3", offset: SHADERTOY_UNIFORM_SIZE + 16 },
        { name: "tint", type: "vec4", offset: SHADERTOY_UNIFORM_SIZE + 32 },
        { name: "enabled", type: "bool", offset: SHADERTOY_UNIFORM_SIZE + 48 },
      ],
      size: SHADERTOY_UNIFORM_SIZE + 64,
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
    expect(buffer.byteLength).toBe(SHADERTOY_UNIFORM_SIZE + 64);
    expect(view.getFloat32(SHADERTOY_UNIFORM_SIZE, true)).toBeCloseTo(0.25);
    expect([view.getFloat32(SHADERTOY_UNIFORM_SIZE + 8, true), view.getFloat32(SHADERTOY_UNIFORM_SIZE + 12, true)]).toEqual([1, 2]);
    expect([view.getFloat32(SHADERTOY_UNIFORM_SIZE + 16, true), view.getFloat32(SHADERTOY_UNIFORM_SIZE + 20, true), view.getFloat32(SHADERTOY_UNIFORM_SIZE + 24, true)])
      .toEqual([3, 4, 5]);
    expect(view.getFloat32(SHADERTOY_UNIFORM_SIZE + 44, true)).toBe(9);
    expect(view.getInt32(SHADERTOY_UNIFORM_SIZE + 48, true)).toBe(1);
  });

  it("zero-fills custom values that have not arrived yet", () => {
    const buffer = packShaderToyUniforms(input, [
      { name: "offset", type: "vec2" },
      { name: "enabled", type: "bool" },
    ]);
    const view = new DataView(buffer);
    expect(view.getFloat32(SHADERTOY_UNIFORM_SIZE, true)).toBe(0);
    expect(view.getFloat32(SHADERTOY_UNIFORM_SIZE + 4, true)).toBe(0);
    expect(view.getInt32(SHADERTOY_UNIFORM_SIZE + 8, true)).toBe(0);
  });
});
