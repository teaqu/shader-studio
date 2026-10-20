import { describe, it, expect } from "vitest";
import { createSlangCustomUniformLayout, packShaderToyUniforms } from "../../webgpu/uniforms";
import { createShaderToyUniformLayout, SHADERTOY_UNIFORM_SIZE, UNIFORM_OFFSETS } from "../../webgpu/SlangPrelude";
import { emptyVrControllers } from "../../webxr/WebXrFrameData";

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

  it("writes iVertexCount and iInstanceCount as the u32 x and y of one 16-byte slot after iCameraDir", () => {
    const layout = createShaderToyUniformLayout(17);
    expect(layout.offsets.iVertexCount).toBe(layout.offsets.iCameraDir + 16);
    expect(layout.offsets.iViewMatrix).toBe(layout.offsets.iVertexCount + 16);

    const dv = new DataView(packShaderToyUniforms({ ...input, channelCount: 17, vertexCount: 2_147_483_647, instanceCount: 2_147_483_647 }));
    expect(dv.getUint32(layout.offsets.iVertexCount, true)).toBe(2_147_483_647);
    expect(dv.getUint32(layout.offsets.iVertexCount + 4, true)).toBe(2_147_483_647);
    expect(dv.getUint32(layout.offsets.iVertexCount + 8, true)).toBe(0);
    expect(dv.getUint32(layout.offsets.iVertexCount + 12, true)).toBe(0);
    expect(dv.getFloat32(layout.offsets.iCameraDir + 8, true)).toBe(-0.75);
  });

  it("defaults iVertexCount to zero when the caller has no vertex count", () => {
    const dv = new DataView(packShaderToyUniforms(input));
    expect(dv.getUint32(UNIFORM_OFFSETS.iVertexCount, true)).toBe(0);
  });

  it("defaults iInstanceCount to one draw when the caller has no instance count", () => {
    const dv = new DataView(packShaderToyUniforms(input));
    expect(dv.getUint32(UNIFORM_OFFSETS.iVertexCount + 4, true)).toBe(1);
  });

  it("starts custom uniforms after the VR block", () => {
    const layout = createSlangCustomUniformLayout([{ name: "gain", type: "float" }]);
    expect(layout.entries[0].offset).toBe(UNIFORM_OFFSETS.iVrControllers + 7 * 32);
    expect(SHADERTOY_UNIFORM_SIZE).toBe(UNIFORM_OFFSETS.iVrControllers + 7 * 32);
  });

  it("lays out the VR block after the 48-byte pointer struct", () => {
    for (const channels of [4, 9]) {
      const { offsets, size } = createShaderToyUniformLayout(channels);
      expect(offsets.iVrState).toBe(offsets.iPointer + 48);
      expect(offsets.iVrViewport).toBe(offsets.iVrState + 16);
      expect(offsets.iVrRayTransform).toBe(offsets.iVrViewport + 16);
      expect(offsets.iVrControllers).toBe(offsets.iVrRayTransform + 64);
      expect(size).toBe(offsets.iVrControllers + 224);
      expect(size % 16).toBe(0);
    }
  });

  it("leaves the VR block zeroed without VR input", () => {
    const buf = packShaderToyUniforms(input);
    const bytes = new Uint8Array(buf, UNIFORM_OFFSETS.iVrState, SHADERTOY_UNIFORM_SIZE - UNIFORM_OFFSETS.iVrState);
    expect(bytes.every(byte => byte === 0)).toBe(true);
  });

  it("packs VR flags, eye viewport, ray transform and controllers", () => {
    const controllers = emptyVrControllers();
    controllers.positions.set([1, 2, 3, 1, 4, 5, 6, 1]);
    controllers.directions.set([0, 0, -1, 1]);
    controllers.buttons.set([0.5], 4);
    controllers.axes.set([-1, 1], 2);
    controllers.faceButtons.set([1], 5);
    controllers.touches.set([1], 3);
    controllers.faceTouches.set([1], 4);
    const rayTransform = Float32Array.from({ length: 16 }, (_, index) => index + 0.5);
    const buf = packShaderToyUniforms({
      ...input,
      vr: { preview: true, immersive: true, active: true, viewport: { x: 1, y: 2, width: 300, height: 400 }, rayTransform, controllers },
    });
    const dv = new DataView(buf);
    const f = (off: number) => dv.getFloat32(off, true);
    expect([0, 1, 2, 3].map(index => dv.getInt32(UNIFORM_OFFSETS.iVrState + index * 4, true))).toEqual([1, 1, 1, 0]);
    expect([0, 1, 2, 3].map(index => f(UNIFORM_OFFSETS.iVrViewport + index * 4))).toEqual([1, 2, 300, 400]);
    expect(Array.from({ length: 16 }, (_, index) => f(UNIFORM_OFFSETS.iVrRayTransform + index * 4))).toEqual(Array.from(rayTransform));
    const field = (index: number) => Array.from({ length: 8 }, (_, component) => f(UNIFORM_OFFSETS.iVrControllers + index * 32 + component * 4));
    expect(field(0)).toEqual([1, 2, 3, 1, 4, 5, 6, 1]);
    expect(field(1)).toEqual([0, 0, -1, 1, 0, 0, 0, 0]);
    expect(field(2)).toEqual([0, 0, 0, 0, 0.5, 0, 0, 0]);
    expect(field(3)).toEqual([0, 0, -1, 1, 0, 0, 0, 0]);
    expect(field(4)).toEqual([0, 0, 0, 0, 0, 1, 0, 0]);
    expect(field(5)).toEqual([0, 0, 0, 1, 0, 0, 0, 0]);
    expect(field(6)).toEqual([0, 0, 0, 0, 1, 0, 0, 0]);
  });

  it("packs only the VR flags that are set", () => {
    const dv = new DataView(packShaderToyUniforms({ ...input, vr: { preview: true } }));
    expect([0, 1, 2].map(index => dv.getInt32(UNIFORM_OFFSETS.iVrState + index * 4, true))).toEqual([1, 0, 0]);
    expect(dv.getFloat32(UNIFORM_OFFSETS.iVrViewport + 8, true)).toBe(0);
    expect(dv.getFloat32(UNIFORM_OFFSETS.iVrRayTransform, true)).toBe(0);
  });

  it("keeps custom uniforms intact after a VR block", () => {
    const info = [{ name: "gain", type: "float" }];
    const buf = packShaderToyUniforms({ ...input, vr: { active: true, controllers: emptyVrControllers() } }, info, [{ name: "gain", type: "float", value: 2.5 }]);
    expect(new DataView(buf).getFloat32(createSlangCustomUniformLayout(info).entries[0].offset, true)).toBe(2.5);
  });

  it("lays out the three camera matrices as consecutive 64-byte slots after iVertexCount", () => {
    for (const channels of [4, 9]) {
      const { offsets, size } = createShaderToyUniformLayout(channels);
      expect(offsets.iViewMatrix).toBe(offsets.iVertexCount + 16);
      expect(offsets.iProjectionMatrix).toBe(offsets.iViewMatrix + 64);
      expect(offsets.iViewProjection).toBe(offsets.iProjectionMatrix + 64);
      expect(offsets.iPointer).toBe(offsets.iViewProjection + 64);
      expect(size).toBe(offsets.iVrControllers + 224);
    }
  });

  it("writes the camera matrices column by column", () => {
    const view = Array.from({ length: 16 }, (_, index) => index + 1);
    const projection = view.map((value) => value * 10);
    const viewProjection = view.map((value) => -value);
    const f32 = new Float32Array(packShaderToyUniforms({ ...input, viewMatrix: view, projectionMatrix: projection, viewProjection }));
    expect(Array.from(f32.subarray(UNIFORM_OFFSETS.iViewMatrix / 4, UNIFORM_OFFSETS.iViewMatrix / 4 + 16))).toEqual(view);
    expect(Array.from(f32.subarray(UNIFORM_OFFSETS.iProjectionMatrix / 4, UNIFORM_OFFSETS.iProjectionMatrix / 4 + 16))).toEqual(projection);
    expect(Array.from(f32.subarray(UNIFORM_OFFSETS.iViewProjection / 4, UNIFORM_OFFSETS.iViewProjection / 4 + 16))).toEqual(viewProjection);
  });

  it("defaults each camera matrix to the identity", () => {
    const f32 = new Float32Array(packShaderToyUniforms(input));
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (const offset of [UNIFORM_OFFSETS.iViewMatrix, UNIFORM_OFFSETS.iProjectionMatrix, UNIFORM_OFFSETS.iViewProjection]) {
      expect(Array.from(f32.subarray(offset / 4, offset / 4 + 16))).toEqual(identity);
    }
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

it('packs the pointer struct without overlapping custom uniforms for every channel count', () => {
  for (const channelCount of [4, 17]) {
    const pointer = { position: [1.5, 2.5] as [number, number], inside: 1, held: 31, pressed: 2, released: 4, modifiers: 15, wheel: [100, -200] as [number, number], wheelDelta: [3, -4] as [number, number] };
    const input = { channelCount, width: 10, height: 10, time: 0, timeDelta: 0, frameRate: 60, frame: 0, mouse: [], channelTime: [], channelLoaded: [], sampleRate: 44100, date: [], channelResolution: [], cameraPos: [], cameraDir: [], pointer };
    const buffer = packShaderToyUniforms(input, [{ name: 'gain', type: 'float' }], [{ name: 'gain', type: 'float', value: 0.75 }]);
    const layout = createShaderToyUniformLayout(channelCount); const f = new Float32Array(buffer); const i = new Int32Array(buffer); const offset = layout.offsets.iPointer / 4;
    expect([...f.slice(offset, offset + 2)]).toEqual([1.5, 2.5]); expect([...i.slice(offset + 2, offset + 8)]).toEqual([1, 31, 2, 4, 15, 0]); expect([...f.slice(offset + 8, offset + 12)]).toEqual([100, -200, 3, -4]); expect(f[layout.size / 4]).toBe(0.75);
    expect([...new Int32Array(packShaderToyUniforms({ ...input, pointer: undefined })).slice(offset, offset + 12)]).toEqual(new Array(12).fill(0));
  }
});
describe('typed script uniform packing', () => {
  it('uses integer writes and std140 scalar array strides', () => {
    const info=[{name:'u',type:'uint'},{name:'i',type:'int'},{name:'a',type:'uint[2]'},{name:'f',type:'float'}];
    const layout=createSlangCustomUniformLayout(info);
    const base = SHADERTOY_UNIFORM_SIZE;
    expect(layout.entries.map(entry=>entry.offset)).toEqual([base,base+4,base+16,base+48]);
    const input={width:1,height:1,time:0,timeDelta:0,frameRate:60,frame:0,mouse:[],channelTime:[],channelLoaded:[],sampleRate:44100,date:[],channelResolution:[],cameraPos:[],cameraDir:[]};
    const buffer=packShaderToyUniforms(input,info,[{name:'u',type:'uint',value:4294967295},{name:'i',type:'int',value:-2147483648},{name:'a',type:'uint[2]',value:[123,4294967295]},{name:'f',type:'float',value:.5}]);
    const view=new DataView(buffer);
    expect(view.getUint32(base+0,true)).toBe(4294967295);expect(view.getInt32(base+4,true)).toBe(-2147483648);
    expect(view.getUint32(base+16,true)).toBe(123);expect(view.getUint32(base+32,true)).toBe(4294967295);
    expect(view.getFloat32(base+48,true)).toBe(.5);
  });
});


describe("typed uniform fallback packing", () => {
  const input = { width: 1, height: 0, time: 0, timeDelta: 0, frameRate: 60, frame: 0, mouse: [], channelTime: [], channelLoaded: [], sampleRate: 44100, date: [], channelResolution: [], cameraPos: [], cameraDir: [] };
  it.each(["float[3]", "int[3]", "uint[3]"])("packs %s with padded strides and zero missing elements", type => {
    const info = [{ name: "values", type }];
    const offset = createSlangCustomUniformLayout(info).entries[0].offset;
    const buffer = packShaderToyUniforms(input, info, [{ name: "values", type, value: [7, 2] }]);
    const view = type.startsWith("uint") ? new Uint32Array(buffer) : type.startsWith("int") ? new Int32Array(buffer) : new Float32Array(buffer);
    expect(Array.from(view.slice(offset / 4, offset / 4 + 12))).toEqual([7, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0]);
    const missing = packShaderToyUniforms(input, info, [{ name: "values", type, value: 9 }]);
    expect(Array.from(new Uint32Array(missing).slice(offset / 4))).toEqual(new Array(12).fill(0));
  });
  it("defaults absent scalar integers, floats and vectors to zero", () => {
    const info = ["int", "uint", "float", "vec2", "vec3", "vec4", "bool"].map((type, i) => ({ name: `u${i}`, type }));
    const buffer = packShaderToyUniforms(input, info);
    expect(Array.from(new Uint32Array(buffer).slice(SHADERTOY_UNIFORM_SIZE / 4))).toEqual(new Array((buffer.byteLength - SHADERTOY_UNIFORM_SIZE) / 4).fill(0));
    expect(new Float32Array(buffer)[2]).toBe(1);
  });
});

it('keeps legacy vector coercion in the WebGPU float upload path', () => {
  const input = {width: 1, height: 1, time: 0, timeDelta: 0, frameRate: 60, frame: 0, mouse: [], channelTime: [], channelLoaded: [], sampleRate: 44100, date: [], channelResolution: [], cameraPos: [], cameraDir: []};
  const info = [{name: 'legacy', type: 'vec3'}];
  // Match the existing host wire contract: vector arity precedes GPU conversion.
  const value = ['1.25', '2.5', 'legacy'] as unknown as number[];
  const offset = createSlangCustomUniformLayout(info).entries[0].offset / 4;
  const buffer = packShaderToyUniforms(input, info, [{name: 'legacy', type: 'vec3', value}]);
  const words = new Float32Array(buffer);
  expect(Array.from(words.slice(offset, offset + 2))).toEqual([1.25, 2.5]);
  expect(Number.isNaN(words[offset + 2])).toBe(true);
});
