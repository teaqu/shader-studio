import { describe, expect, it, vi } from "vitest";
import {
  buildRenderCaptureShaderInfo,
  describeRenderInputLimitations,
  renderInputLimitations,
} from "../../lib/recording/captureSnapshot";
import { createRenderCaptureSnapshot } from "../../lib/recording/types";

const source = {
  code: "shader",
  config: null,
  path: "/shader.glsl",
  buffers: {},
};

function createEngine() {
  return {
    getCustomUniformDeclarations: vi.fn(() => "uniform float cached;"),
    getCustomUniformInfo: vi.fn(() => [{ name: "cached", type: "float" }]),
    getCurrentCustomUniforms: vi.fn((): Array<{
      name: string;
      type: string;
      value: number | number[] | boolean;
    }> => [
      { name: "cached", type: "float", value: 0 },
      { name: "enabled", type: "bool", value: false },
      { name: "stale", type: "float", value: 1 },
    ]),
  };
}

describe("buildRenderCaptureShaderInfo", () => {
  it("uses cached declarations for an incremental message that omits script context", () => {
    const engine = createEngine();
    const info = buildRenderCaptureShaderInfo({ ...source, scriptContextOmitted: true }, engine);

    expect(info.customUniformDeclarations).toBe("uniform float cached;");
    expect(info.customUniformInfo).toEqual([{ name: "cached", type: "float" }]);
    expect(info.customUniformValues).toEqual([
      { name: "cached", type: "float", value: 0 },
    ]);
  });

  it("keeps zero and false values sampled from the live engine", () => {
    const engine = createEngine();
    const info = buildRenderCaptureShaderInfo({
      ...source,
      customUniformDeclarations: "uniform float cached; uniform bool enabled;",
      customUniformInfo: [
        { name: "cached", type: "float" },
        { name: "enabled", type: "bool" },
      ],
    }, engine);

    expect(info.customUniformValues).toEqual([
      { name: "cached", type: "float", value: 0 },
      { name: "enabled", type: "bool", value: false },
    ]);
  });

  it("honors an explicit clear without leaking values from the previous shader", () => {
    const engine = createEngine();
    const info = buildRenderCaptureShaderInfo({
      ...source,
      customUniformDeclarations: undefined,
      customUniformInfo: [],
    }, engine);

    expect(info.customUniformDeclarations).toBeUndefined();
    expect(info.customUniformInfo).toEqual([]);
    expect(info.customUniformValues).toEqual([]);
    expect(engine.getCustomUniformDeclarations).not.toHaveBeenCalled();
  });

  it("filters stale live values when a shader declares a new context", () => {
    const engine = createEngine();
    engine.getCurrentCustomUniforms.mockReturnValue([
      { name: "stale", type: "float", value: 1 },
      { name: "fresh", type: "vec2", value: [0.25, 0.5] },
    ]);
    const info = buildRenderCaptureShaderInfo({
      ...source,
      customUniformDeclarations: "uniform vec2 fresh;",
      customUniformInfo: [{ name: "fresh", type: "vec2" }],
    }, engine);

    expect(info.customUniformValues).toEqual([
      { name: "fresh", type: "vec2", value: [0.25, 0.5] },
    ]);
  });

  it("filters a stale value when the same uniform name changes type", () => {
    const engine = createEngine();
    engine.getCurrentCustomUniforms.mockReturnValue([
      { name: "changed", type: "float", value: 1 },
      { name: "changed", type: "vec2", value: [0.25, 0.5] },
    ]);
    const info = buildRenderCaptureShaderInfo({
      ...source,
      customUniformDeclarations: "uniform vec2 changed;",
      customUniformInfo: [{ name: "changed", type: "vec2" }],
    }, engine);

    expect(info.customUniformValues).toEqual([
      { name: "changed", type: "vec2", value: [0.25, 0.5] },
    ]);
  });
});

describe("createRenderCaptureSnapshot", () => {
  it("detaches every mutable input, including Svelte-compatible proxy data", () => {
    const config = new Proxy({
      version: "1",
      passes: { Image: { resolution: { scale: 1 } } },
    }, {});
    const buffers = { BufferA: "buffer source" };
    const uniformInfo = [{ name: "matrix", type: "mat2" }];
    const values = new Proxy([
      { name: "matrix", type: "mat2", value: [1, 0, 0, 1] },
    ], {});
    const modules = [{
      moduleName: "palette",
      path: "/palette.slang",
      source: "original module",
      ownerPass: "Image",
    }];
    const sourcePaths = { Image: "/image.slang" };

    const snapshot = createRenderCaptureSnapshot({
      ...source,
      config,
      buffers,
      customUniformInfo: uniformInfo,
      customUniformValues: values,
      slangModules: modules,
      slangSourcePaths: sourcePaths,
    });
    config.passes.Image.resolution.scale = 2;
    buffers.BufferA = "changed buffer";
    uniformInfo[0].name = "changed";
    values[0].value[0] = 9;
    modules[0].source = "changed module";
    sourcePaths.Image = "/changed.slang";

    expect(snapshot.config?.passes.Image.resolution?.scale).toBe(1);
    expect(snapshot.buffers).toEqual({ BufferA: "buffer source" });
    expect(snapshot.customUniformInfo).toEqual([{ name: "matrix", type: "mat2" }]);
    expect(snapshot.customUniformValues[0].value).toEqual([1, 0, 0, 1]);
    expect(snapshot.slangModules?.[0].source).toBe("original module");
    expect(snapshot.slangSourcePaths).toEqual({ Image: "/image.slang" });
  });

  it("snapshots the displayed (frozen while paused) values instead of ones that changed underneath", () => {
    const engine = {
      ...createEngine(),
      getDisplayedCustomUniforms: vi.fn(() => [{ name: "cached", type: "float", value: 7 }]),
    };

    const info = buildRenderCaptureShaderInfo({ ...source, scriptContextOmitted: true }, engine);

    expect(info.customUniformValues).toEqual([{ name: "cached", type: "float", value: 7 }]);
    expect(engine.getCurrentCustomUniforms).not.toHaveBeenCalled();
  });
});

describe("renderInputLimitations", () => {
  it("reports nothing for a shader without live inputs", () => {
    expect(renderInputLimitations({ code: "void mainImage(out vec4 c, vec2 p) {}", buffers: {}, config: null })).toEqual([]);
    expect(describeRenderInputLimitations([])).toBeNull();
  });

  it("finds iMouse in the main shader or any buffer, and keyboard/audio/video channels", () => {
    const kinds = renderInputLimitations({
      code: "void mainImage(out vec4 c, vec2 p) { c = texture(iChannel0, p); }",
      buffers: { BufferA: "float m = iMouse.x;" },
      config: {
        version: "1.0",
        passes: {
          Image: { inputs: { iChannel0: { type: "audio", path: "a.mp3" }, iChannel1: { type: "keyboard" } } },
          BufferA: { path: "a.glsl", inputs: { iChannel0: { type: "video", path: "v.mp4" } } },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a partial config keeps the fixture focused on inputs
      } as any,
    });

    expect(kinds).toEqual(["mouse", "keyboard", "audio", "video"]);
    expect(describeRenderInputLimitations(kinds)).toBe(
      "Render doesn't replay live input: iMouse stays at its idle value; keyboard, audio and video inputs aren't replayed on the export timeline. Use Live to capture interaction.",
    );
  });

  it("doesn't mistake identifiers that only contain iMouse", () => {
    expect(renderInputLimitations({ code: "float myiMouseX = 1.0;", buffers: {}, config: null })).toEqual([]);
    expect(describeRenderInputLimitations(["audio"])).toBe(
      "Render doesn't replay live input: audio input isn't replayed on the export timeline. Use Live to capture interaction.",
    );
  });
});
