import { describe, expect, it } from "vitest";
import {
  createShaderToyUniformLayout,
  DBG_CAPTURE_OFFSETS,
  DBG_CAPTURE_UNIFORM_SIZE,
  type SlangChannelBinding,
} from "../../webgpu/SlangPrelude";
import { createSlangCustomUniformLayout } from "../../webgpu/uniforms";
import type { StorageBindingNode } from "../../types/PassGraph";
import {
  WGSL_ENTRY_FRAGMENT,
  WGSL_ENTRY_VERTEX,
  buildWgslStorageDeclarations,
  getWgslComputeEntryPoints,
  injectComputeInit,
  wrapWgslComputeSource,
  wrapWgslImageSource,
} from "../../webgpu/WgslPrelude";

/**
 * Independent WGSL uniform-address-space layout oracle. It parses the emitted
 * struct text and applies the WGSL alignment rules from scratch, so a wrong
 * member order, wrong type, or wrong array form in the prelude fails here even
 * though the builder never computes offsets itself.
 */
const WGSL_SCALAR_LAYOUT: Record<string, { align: number; size: number }> = {
  "f32": { align: 4, size: 4 },
  "i32": { align: 4, size: 4 },
  "u32": { align: 4, size: 4 },
  "vec2<f32>": { align: 8, size: 8 },
  "vec3<f32>": { align: 16, size: 12 },
  "vec4<f32>": { align: 16, size: 16 },
  "vec2<i32>": { align: 8, size: 8 },
  "vec3<i32>": { align: 16, size: 12 },
  "vec4<i32>": { align: 16, size: 16 },
  "vec2<u32>": { align: 8, size: 8 },
  "vec3<u32>": { align: 16, size: 12 },
  "vec4<u32>": { align: 16, size: 16 },
  "mat4x4<f32>": { align: 16, size: 64 },
};

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function wgslMemberLayout(type: string): { align: number; size: number } {
  const array = /^array<(.+),\s*(\d+)>$/.exec(type.trim());
  if (array) {
    const element = WGSL_SCALAR_LAYOUT[array[1]!.trim()];
    if (!element) {
      throw new Error(`oracle does not know element type ${array[1]}`);
    }
    // Uniform address space: array stride is a multiple of 16.
    const stride = alignTo(element.align, 16);
    return { align: element.align, size: stride * Number(array[2]) };
  }
  const scalar = WGSL_SCALAR_LAYOUT[type.trim()];
  if (!scalar) {
    throw new Error(`oracle does not know type ${type}`);
  }
  return scalar;
}

/** Offsets of each member of the named struct, computed from the emitted text. */
function wgslStructOffsets(source: string, structName: string): Map<string, number> {
  const body = new RegExp(`struct\\s+${structName}\\s*\\{([\\s\\S]*?)\\}`, "").exec(source)?.[1];
  if (body === undefined) {
    throw new Error(`struct ${structName} not found in emitted source`);
  }
  const offsets = new Map<string, number>();
  let offset = 0;
  for (const line of body.split("\n")) {
    const member = /^\s*([A-Za-z_]\w*)\s*:\s*(.+?)\s*,?\s*$/.exec(line);
    if (!member) {
      continue;
    }
    const layout = wgslMemberLayout(member[2]!);
    offset = alignTo(offset, layout.align);
    offsets.set(member[1]!, offset);
    offset += layout.size;
  }
  return offsets;
}

function channel(key: string, slot: number, kind: SlangChannelBinding["kind"] = "texture"): SlangChannelBinding {
  return { key, slot, kind, textureIdentity: `tex:${slot}`, samplerIdentity: `smp:${slot}` };
}

function storageNode(name: string, binding: number, elementType: string, builtin: boolean): StorageBindingNode {
  return { name, binding, elementType, builtin, count: 64, stride: 16 };
}

describe("wrapWgslImageSource uniform block", () => {
  it("provides the editor-advertised channel Load helper with ShaderToy coordinates", () => {
    const { source } = wrapWgslImageSource("fn mainImage(coord: vec2f) -> vec4f { return stateLoad(vec2i(0)); }", {
      channels: [channel("state", 0)],
    });

    expect(source).toContain("fn stateLoad(pixel: vec2i) -> vec4f {");
    expect(source).toContain("return load2D(stateTexture, pixel);");
  });

  it("provides Load in compute and vertex modules but never for cubemaps", () => {
    const compute = wrapWgslComputeSource("@compute @workgroup_size(1) fn update() { let cell = stateLoad(vec2i(0)); }", {
      channels: [channel("state", 0)],
      workgroupSize: [1, 1, 1], outputLayers: 1, hasOutput: false,
    }).source;
    const vertex = wrapWgslImageSource("fn mainImage(coord: vec2f) -> vec4f { return vec4f(0.0); }", {
      channels: [channel("state", 0)],
      vertexCode: "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) { let cell = stateLoad(vec2i(0)); }",
    }).source;
    const cubemap = wrapWgslImageSource("fn mainImage(coord: vec2f) -> vec4f { return vec4f(0.0); }", {
      channels: [channel("sky", 0, "cubemap")],
    }).source;

    expect(compute).toContain("fn stateLoad(pixel: vec2i) -> vec4f {");
    expect(vertex).toContain("fn stateLoad(pixel: vec2i) -> vec4f {");
    expect(cubemap).not.toContain("fn skyLoad(");
  });

  it.each([4, 5, 8])("reproduces the packed byte offsets for %i channels", (channelCount) => {
    const channels = Array.from({ length: channelCount }, (_, slot) => channel(`iChannel${slot}`, slot));
    const { source } = wrapWgslImageSource("fn mainImage(coord: vec2<f32>) -> vec4<f32> { return vec4<f32>(0.0); }", { channels });

    const expected = createShaderToyUniformLayout(channelCount).offsets;
    const actual = wgslStructOffsets(source, "_ss_ShaderToyUniforms");
    expect(actual.get("resolution")).toBe(expected.iResolution);
    expect(actual.get("mouse")).toBe(expected.iMouse);
    expect(actual.get("time")).toBe(expected.iTime);
    expect(actual.get("timeDelta")).toBe(expected.iTimeDelta);
    expect(actual.get("frameRate")).toBe(expected.iFrameRate);
    expect(actual.get("frame")).toBe(expected.iFrame);
    expect(actual.get("channelTime")).toBe(expected.iChannelTime);
    expect(actual.get("channelLoaded")).toBe(expected.iChannelLoaded);
    expect(actual.get("sampleRate")).toBe(expected.iSampleRate);
    expect(actual.get("date")).toBe(expected.iDate);
    expect(actual.get("channelResolution")).toBe(expected.iChannelResolution);
    expect(actual.get("cameraPos")).toBe(expected.iCameraPos);
    expect(actual.get("cameraDir")).toBe(expected.iCameraDir);
  });

  it("never emits scalar arrays in uniform space (stride 16 is required)", () => {
    const { source } = wrapWgslImageSource("fn mainImage(coord: vec2<f32>) -> vec4<f32> { return vec4<f32>(0.0); }", {
      channels: [channel("iChannel0", 0)],
    });
    expect(source).not.toMatch(/array<\s*(f32|i32|u32)\s*,/);
  });

  it("matches custom uniform offsets for every type", () => {
    const customUniforms = [
      { name: "uFloat", type: "float" },
      { name: "uVec2", type: "vec2" },
      { name: "uVec3", type: "vec3" },
      { name: "uVec4", type: "vec4" },
      { name: "uBool", type: "bool" },
    ];
    const { source } = wrapWgslImageSource("fn mainImage(coord: vec2<f32>) -> vec4<f32> { return vec4<f32>(0.0); }", { customUniforms });

    const expected = createSlangCustomUniformLayout(customUniforms, 4);
    const actual = wgslStructOffsets(source, "_ss_ShaderToyUniforms");
    for (const entry of expected.entries) {
      expect(actual.get(`custom_${entry.name}`)).toBe(entry.offset);
    }
  });

  it("matches custom uniform offsets for mixed-type orderings that trigger padding", () => {
    const customUniforms = [
      { name: "a", type: "float" },
      { name: "b", type: "vec3" },
      { name: "c", type: "float" },
      { name: "d", type: "vec2" },
      { name: "e", type: "bool" },
      { name: "f", type: "vec4" },
    ];
    const { source } = wrapWgslImageSource("fn mainImage(coord: vec2<f32>) -> vec4<f32> { return vec4<f32>(0.0); }", { customUniforms });

    const expected = createSlangCustomUniformLayout(customUniforms, 4);
    const actual = wgslStructOffsets(source, "_ss_ShaderToyUniforms");
    for (const entry of expected.entries) {
      expect(actual.get(`custom_${entry.name}`)).toBe(entry.offset);
    }
  });

  it("declares bare custom uniform globals initialised from the uniform block", () => {
    const { source } = wrapWgslImageSource("fn mainImage(coord: vec2<f32>) -> vec4<f32> { return vec4<f32>(0.0); }", {
      customUniforms: [
        { name: "myKnob", type: "float" },
        { name: "myFlag", type: "bool" },
      ],
    });
    expect(source).toContain("var<private> myKnob: f32;");
    expect(source).toContain("var<private> myFlag: bool;");
    expect(source).toContain("myKnob = _ss_u.custom_myKnob;");
    expect(source).toContain("myFlag = _ss_u.custom_myFlag != 0;");
  });
});

describe("wrapWgslImageSource channels", () => {
  const IMAGE = "fn mainImage(coord: vec2<f32>) -> vec4<f32> { return iChannel0Sample(coord); }";

  it("emits one texture/sampler pair with fragment-only sampling accessors", () => {
    const { source } = wrapWgslImageSource(IMAGE, { channels: [channel("iChannel0", 0)] });
    expect(source).toContain("@group(0) @binding(1) var iChannel0Texture: texture_2d<f32>;");
    expect(source).toContain("@group(0) @binding(2) var iChannel0Sampler: sampler;");
    expect(source).toContain("fn iChannel0Sample(uv: vec2<f32>) -> vec4<f32>");
    expect(source).toContain("textureSample(iChannel0Texture, iChannel0Sampler, vec2<f32>(uv.x, 1.0 - uv.y));");
    expect(source).toContain("fn iChannel0SampleLevel(uv: vec2<f32>, lod: f32) -> vec4<f32>");
    expect(source).toContain("fn iChannel0SampleGrad(uv: vec2<f32>, dx: vec2<f32>, dy: vec2<f32>) -> vec4<f32>");
    expect(source).toContain("vec2<f32>(dx.x, -dx.y)");
    expect(source).toContain("fn iChannel0Size() -> vec2<u32>");
    expect(source).toContain("vec2<u32>(_ss_u.channelResolution[0].xy)");
    expect(source).toContain("fn iChannel0Time() -> f32");
    expect(source).toContain("_ss_u.channelTime[0].x");
    expect(source).toContain("fn iChannel0Loaded() -> bool");
    expect(source).toContain("_ss_u.channelLoaded[0].x != 0.0");
  });

  it("deduplicates shared texture bindings but keeps per-channel accessors", () => {
    const shared = (key: string, slot: number): SlangChannelBinding => (
      { key, slot, kind: "texture", textureIdentity: "shared-tex", samplerIdentity: `smp:${slot}` }
    );
    const { source } = wrapWgslImageSource(IMAGE, { channels: [shared("iChannel0", 0), shared("iChannel2", 2)] });
    expect(source.match(/var iChannel0Texture: texture_2d<f32>;/g)).toHaveLength(1);
    expect(source).not.toContain("iChannel2Texture");
    expect(source).toContain("fn iChannel0Sample(");
    expect(source).toContain("fn iChannel2Sample(");
    expect(source).toContain("fn iChannel2Size() -> vec2<u32>");
    expect(source).toContain("_ss_u.channelResolution[2].xy");
  });

  it("emits texture_cube with no y-flip for cubemap channels", () => {
    const { source } = wrapWgslImageSource(IMAGE, { channels: [channel("iChannel0", 0, "cubemap")] });
    expect(source).toContain("var iChannel0Texture: texture_cube<f32>;");
    expect(source).toContain("fn iChannel0Sample(dir: vec3<f32>) -> vec4<f32>");
    expect(source).toContain("textureSample(iChannel0Texture, iChannel0Sampler, dir)");
    expect(source).not.toContain("1.0 - uv.y");
  });
});

describe("wrapWgslImageSource entry points", () => {
  const IMAGE = "fn mainImage(coord: vec2<f32>) -> vec4<f32> { return vec4<f32>(coord.x); }";

  it("uses the pipeline's fixed vertexMain/fragmentMain entry names", () => {
    expect(WGSL_ENTRY_VERTEX).toBe("vertexMain");
    expect(WGSL_ENTRY_FRAGMENT).toBe("fragmentMain");
    const { source } = wrapWgslImageSource(IMAGE);
    expect(source).toContain("@vertex fn vertexMain(");
    expect(source).toContain("@fragment fn fragmentMain(");
  });

  it("initialises globals first and flips Y for the ShaderToy origin", () => {
    const { source } = wrapWgslImageSource(IMAGE);
    const fragment = source.slice(source.indexOf("@fragment fn fragmentMain"));
    expect(fragment.indexOf("_ss_initGlobals();")).toBeLessThan(fragment.indexOf("return mainImage("));
    expect(fragment).toContain("mainImage(vec2<f32>(fragCoord.x, _ss_u.resolution.y - fragCoord.y))");
  });

  it("generates a no-op pointer vertex hook when the user supplies no vertex code", () => {
    const { source } = wrapWgslImageSource(IMAGE);
    expect(source).toContain(
      "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {}",
    );
  });

  it("calls a user vertex hook with mutable locals", () => {
    const { source } = wrapWgslImageSource(IMAGE, {
      vertexCode: "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) { *uv = *uv * 2.0; }",
    });
    expect(source).toContain("mainVertex(vid, &position, &normal, &uv)");
  });

  describe("fullscreen stays as in #275", () => {
    const hook = "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {}";
    const vertexEntry = (source: string) => source.slice(source.indexOf("@vertex fn vertexMain"), source.indexOf("@fragment"));
    const DEFAULT_HOOK_ENTRY = `@vertex fn vertexMain(@builtin(vertex_index) vid: u32) -> _ss_VertexUvOut {
  _ss_initGlobals();
  var verts = array<vec2<f32>, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var position = vec3<f32>(verts[vid], 0.0);
  var normal = vec3<f32>(0.0, 0.0, 1.0);
  var uv = verts[vid] * 0.5 + 0.5;
  mainVertex(vid, &position, &normal, &uv);
  var output: _ss_VertexUvOut;
  output.position = vec4<f32>(position, 1.0);
  output.uv = uv;
  return output;
}

`;

    it("keeps the source byte-for-byte and ignores vertexSpace", () => {
      for (const vertexCode of [undefined, hook]) {
        const fullscreen = wrapWgslImageSource(IMAGE, { vertexCode });
        expect(wrapWgslImageSource(IMAGE, { vertexCode, geometry: "fullscreen", vertexSpace: "clip" })).toEqual(fullscreen);
        expect(fullscreen.source).not.toContain("% 3u");
        expect(fullscreen.source).not.toContain("_ss_mesh");
      }
      expect(vertexEntry(wrapWgslImageSource(IMAGE, { vertexCode: hook }).source)).toBe(DEFAULT_HOOK_ENTRY);
    });

    it("initialises iVertexCount as u32 from the uniform block in both stages", () => {
      const { source } = wrapWgslImageSource(IMAGE, { vertexCode: hook });
      expect(source).toContain("  cameraDir: vec4<f32>,\n  vertexCount: vec4<u32>,\n");
      expect(source).toContain("var<private> iVertexCount: u32;");
      expect(source).toContain("  iVertexCount = _ss_u.vertexCount.x;");
      expect(source).toContain("var<private> iVertexUv: vec2<f32>;");
      expect(source).toContain("var<private> iFrontFacing: bool;");
    });
  });

  describe("camera matrices", () => {
    it("declares the matrices after vertexCount and copies them into private globals", () => {
      const { source } = wrapWgslImageSource(IMAGE);
      expect(source).toContain("  vertexCount: vec4<u32>,\n  viewMatrix: mat4x4<f32>,\n  projectionMatrix: mat4x4<f32>,\n  viewProjection: mat4x4<f32>,\n");
      for (const [name, field] of [["iViewMatrix", "viewMatrix"], ["iProjectionMatrix", "projectionMatrix"], ["iViewProjection", "viewProjection"]]) {
        expect(source).toContain(`var<private> ${name}: mat4x4<f32>;`);
        expect(source).toContain(`  ${name} = _ss_u.${field};`);
      }
    });
  });

  describe("instancing", () => {
    const hook = "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {}";

    it("declares iInstanceCount from the y lane of the vertexCount slot and a private iInstanceIndex", () => {
      const { source } = wrapWgslImageSource(IMAGE);
      expect(source).toContain("var<private> iInstanceCount: u32;");
      expect(source).toContain("  iInstanceCount = _ss_u.vertexCount.y;");
      expect(source).toContain("var<private> iInstanceIndex: u32;");
    });

    it("leaves iInstanceIndex at its zero initial value for fullscreen and capture entries", () => {
      for (const options of [{}, { vertexCode: hook }, { captureMode: true }]) {
        const { source } = wrapWgslImageSource(IMAGE, options);
        expect(source).not.toContain("instance_index");
        expect(source).not.toContain("iInstanceIndex =");
        expect(source).not.toContain("@interpolate(flat)");
      }
    });
  });

  describe("vertices geometry", () => {
    const hook = "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {\n  (*position).x = f32(vertexIndex);\n}";
    const SEED = `  var position = vec3<f32>(0.0, 0.0, 0.0);
  var normal = vec3<f32>(0.0, 0.0, 1.0);
  var uv = vec2<f32>(0.0, 0.0);
  mainVertex(vid, &position, &normal, &uv);`;

    it.each([undefined, "world"] as const)("projects world-space output through the camera with no vertex inputs (vertexSpace %s)", (vertexSpace) => {
      const result = wrapWgslImageSource(IMAGE, { geometry: "vertices", vertexCode: hook, ...(vertexSpace ? { vertexSpace } : {}) });

      expect(result.source).toContain("var<uniform> _ss_mesh: _ss_MeshUniforms;");
      expect(result.source).toContain(`@vertex fn vertexMain(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> _ss_MeshVertexOut {\n  _ss_initGlobals();\n  iInstanceIndex = iid;\n${SEED}\n  let worldPosition = _ss_mesh.model * vec4<f32>(position, 1.0);`);
      expect(result.source).toContain("output.position = _ss_mesh.viewProjection * worldPosition;");
      expect(result.source).toContain("  output.instanceIndex = iid;");
      expect(result.source).toContain("@location(3) @interpolate(flat) instanceIndex: u32,\n}");
      expect(result.source).toContain("  iInstanceIndex = instanceIndex;");
      expect(result.source).toContain("return mainImage(uv * _ss_u.resolution.xy);");
      expect(result.source).not.toContain("@location(0) position");
      expect(result.source).not.toContain("verts[");
      const lines = result.source.split("\n");
      expect(lines[result.vertexRange!.startLine - 1]).toBe(hook.split("\n")[0]);
      expect(result.vertexRange!.lineCount).toBe(3);
    });

    it("writes clip-space output straight to the position builtin and shades with the pixel coordinate", () => {
      const result = wrapWgslImageSource(IMAGE, { geometry: "vertices", vertexSpace: "clip", vertexCode: hook });

      expect(result.source).toContain(`@vertex fn vertexMain(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> _ss_VertexUvOut {\n  _ss_initGlobals();\n  iInstanceIndex = iid;\n${SEED}\n  var output: _ss_VertexUvOut;\n  output.position = vec4<f32>(position, 1.0);\n  output.uv = uv;\n  output.instanceIndex = iid;\n  return output;\n}`);
      expect(result.source).toContain("@location(1) @interpolate(flat) instanceIndex: u32,\n}");
      expect(result.source).toContain("@location(0) uv: vec2<f32>, @location(1) @interpolate(flat) instanceIndex: u32, @builtin(front_facing) frontFacing: bool)");
      expect(result.source).toContain("  _ss_initGlobals();\n  iInstanceIndex = instanceIndex;");
      expect(result.source).toContain("return mainImage(vec2<f32>(fragCoord.x, _ss_u.resolution.y - fragCoord.y));");
      expect(result.source).toContain("iVertexUv = uv;");
      expect(result.source).toContain("iFrontFacing = frontFacing;");
      expect(result.source).not.toContain("_ss_mesh");
      expect(result.source).not.toContain("verts[");
      const lines = result.source.split("\n");
      expect(lines[result.vertexRange!.startLine - 1]).toBe(hook.split("\n")[0]);
    });

    it.each(["world", "clip"] as const)("declares a no-op hook in %s space when none is configured", (vertexSpace) => {
      const result = wrapWgslImageSource(IMAGE, { geometry: "vertices", vertexSpace });

      expect(result.source).toContain("fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {}");
      expect(result.source).toContain(SEED);
      expect(result.vertexRange).toBeUndefined();
    });

    it("keeps common code attribution past the world-space mesh prelude", () => {
      const common = "fn helper() -> f32 { return 1.0; }";
      const result = wrapWgslImageSource(IMAGE, { geometry: "vertices", vertexCode: hook, commonCode: common });
      const lines = result.source.split("\n");

      expect(lines[result.commonRange!.startLine - 1]).toBe(common);
    });

    it("ignores vertexSpace for mesh geometry and capture mode", () => {
      expect(wrapWgslImageSource(IMAGE, { geometry: "plane", vertexCode: hook, vertexSpace: "clip" }))
        .toEqual(wrapWgslImageSource(IMAGE, { geometry: "plane", vertexCode: hook }));
      expect(wrapWgslImageSource(IMAGE, { captureMode: true, geometry: "vertices", vertexSpace: "clip" }))
        .toEqual(wrapWgslImageSource(IMAGE, { captureMode: true }));
    });
  });

  it("runs a fullscreen hook with the triangle vertex index", () => {
    const { source } = wrapWgslImageSource(IMAGE, {
      vertexCode: "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {}",
    });
    const vertex = source.slice(source.indexOf("@vertex fn vertexMain"), source.indexOf("@fragment"));
    expect(vertex).toContain("@builtin(vertex_index) vid: u32");
    expect(vertex).toContain("var verts = array<vec2<f32>, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));");
    expect(vertex).toContain("var normal = vec3<f32>(0.0, 0.0, 1.0);");
    expect(vertex).toContain("mainVertex(vid, &position, &normal, &uv);");
  });

  it.each(["plane", "cube", "sphere", "model"] as const)("passes the %s mesh vertex index to the hook", (geometry) => {
    const { source } = wrapWgslImageSource(IMAGE, {
      geometry,
      vertexCode: "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {}",
    });
    expect(source).toContain("@location(2) uv: vec2<f32>, @builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> _ss_MeshVertexOut {\n  _ss_initGlobals();\n  iInstanceIndex = iid;\n  var p = position;");
    expect(source).toContain("mainVertex(vid, &p, &n, &t);");
    expect(source).toContain("  output.instanceIndex = iid;");
    expect(source).toContain("@location(3) @interpolate(flat) instanceIndex: u32, @builtin(front_facing) frontFacing: bool)");
  });

  it("declares a vertex-index stub hook for meshes without vertex code", () => {
    const { source, vertexRange } = wrapWgslImageSource(IMAGE, { geometry: "cube" });
    expect(source).toContain(
      "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {}",
    );
    expect(source).toContain("mainVertex(vid, &p, &n, &t);");
    expect(vertexRange).toBeUndefined();
  });

  it("reports the hook range where the hook text actually sits in the module", () => {
    const hook = [
      "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {",
      "  *uv = *uv * 2.0;",
      "}",
    ].join("\n");
    const { source, vertexRange } = wrapWgslImageSource(IMAGE, { vertexCode: hook });
    expect(vertexRange).toBeDefined();
    const lines = source.split("\n");
    const hookStart = lines.indexOf(hook.split("\n")[0]) + 1;
    expect(hookStart).toBeGreaterThan(0);
    expect(vertexRange?.startLine).toBe(hookStart);
    expect(vertexRange?.lineCount).toBe(3);
    expect(lines.slice(hookStart - 1, hookStart + 2).join("\n")).toBe(hook);
  });

  it("omits the hook range when the generated stub stands in", () => {
    const { source, vertexRange } = wrapWgslImageSource(IMAGE);
    expect(source).toContain("fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {}");
    expect(vertexRange).toBeUndefined();
  });

  it("reports the hook range for mesh geometry", () => {
    const hook = "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {}";
    const { source, vertexRange } = wrapWgslImageSource(IMAGE, { geometry: "sphere", vertexCode: hook });
    expect(vertexRange?.lineCount).toBe(1);
    const lines = source.split("\n");
    const hookStart = lines.indexOf(hook) + 1;
    expect(hookStart).toBeGreaterThan(0);
    expect(vertexRange?.startLine).toBe(hookStart);
  });

  it("ports the mesh prelude with column-major matrices and location attributes", () => {
    const { source } = wrapWgslImageSource(IMAGE, {
      geometry: "sphere",
      vertexCode: "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {}",
    });
    expect(source).toContain("model: mat4x4<f32>");
    expect(source).toContain("@location(0) position: vec3<f32>");
    expect(source).toContain("@location(1) normal: vec3<f32>");
    expect(source).toContain("@location(2) uv: vec2<f32>");
    expect(source).toContain("iWorldPosition = worldPos;");
  });
});

describe("buildWgslStorageDeclarations", () => {
  it("maps builtin element types for render passes", () => {
    const storage = [
      storageNode("a", 0, "float4", true),
      storageNode("b", 1, "Atomic<uint>", true),
      storageNode("c", 2, "Atomic<int>", true),
      storageNode("d", 3, "float2x2", true),
    ];
    const { beforeCommon, afterCommon } = buildWgslStorageDeclarations(storage, 4, "render", 9);
    expect(afterCommon).toBe("");
    expect(beforeCommon).toContain("@group(0) @binding(9) var<storage, read> a: array<vec4<f32>>;");
    expect(beforeCommon).toContain("@group(0) @binding(10) var<storage, read> b: array<u32>;");
    expect(beforeCommon).toContain("@group(0) @binding(11) var<storage, read> c: array<i32>;");
    expect(beforeCommon).toContain("@group(0) @binding(12) var<storage, read> d: array<mat2x2<f32>>;");
  });

  it("maps atomics to read_write atomic types for compute passes", () => {
    const storage = [
      storageNode("a", 0, "Atomic<uint>", true),
      storageNode("b", 1, "Atomic<int>", true),
      storageNode("c", 2, "int3", true),
    ];
    const { beforeCommon } = buildWgslStorageDeclarations(storage, 4, "compute", 5);
    expect(beforeCommon).toContain("@group(0) @binding(5) var<storage, read_write> a: array<atomic<u32>>;");
    expect(beforeCommon).toContain("@group(0) @binding(6) var<storage, read_write> b: array<atomic<i32>>;");
    expect(beforeCommon).toContain("@group(0) @binding(7) var<storage, read_write> c: array<vec3<i32>>;");
  });

  it("uses read_write access for render storage whose custom type contains atomics", () => {
    const storage = [{
      ...storageNode("counter", 0, "Counter", false),
      containsAtomic: true,
    }];
    const { afterCommon } = buildWgslStorageDeclarations(storage, 0, "render", 1);
    expect(afterCommon).toContain("@group(0) @binding(1) var<storage, read_write> counter: array<Counter>;");
  });

  it("preserves native f16 storage type spellings", () => {
    const storage = [
      storageNode("scalar", 0, "f16", true),
      storageNode("vector", 1, "vec3<f16>", true),
      storageNode("matrix", 2, "mat4x4<f16>", true),
    ];
    const { beforeCommon } = buildWgslStorageDeclarations(storage, 0, "compute", 1);
    expect(beforeCommon).toContain("scalar: array<f16>;");
    expect(beforeCommon).toContain("vector: array<vec3<f16>>;");
    expect(beforeCommon).toContain("matrix: array<mat4x4<f16>>;");
  });

  it("splits custom element types after common code by their type dependency", () => {
    const storage = [
      storageNode("builtinBuf", 0, "float4", true),
      storageNode("customBuf", 1, "MyParticle", false),
    ];
    const { beforeCommon, afterCommon } = buildWgslStorageDeclarations(storage, 4, "render", 9);
    expect(beforeCommon).toContain("builtinBuf");
    expect(beforeCommon).not.toContain("customBuf");
    expect(afterCommon).toContain("@group(0) @binding(10) var<storage, read> customBuf: array<MyParticle>;");
  });

  it("places custom storage declarations after user source in the assembled module", () => {
    const userSource = "struct MyParticle { pos: vec4<f32>; }\nfn mainImage(coord: vec2<f32>) -> vec4<f32> { return vec4<f32>(0.0); }";
    const { source } = wrapWgslImageSource(userSource, {
      storage: [storageNode("customBuf", 0, "MyParticle", false)],
    });
    expect(source.indexOf("struct MyParticle")).toBeLessThan(source.indexOf("var<storage, read> customBuf"));
  });
});

describe("getWgslComputeEntryPoints", () => {
  it("finds entries with explicit workgroup sizes", () => {
    const entries = getWgslComputeEntryPoints(
      "@compute @workgroup_size(8, 8, 1)\nfn mainCompute(@builtin(global_invocation_id) id: vec3<u32>) {}",
    );
    expect(entries).toEqual([{ name: "mainCompute", workgroupSize: [8, 8, 1] }]);
  });

  it("handles the reversed attribute order and defaulted y/z", () => {
    expect(getWgslComputeEntryPoints("@workgroup_size(16) @compute\nfn a() {}")).toEqual([
      { name: "a", workgroupSize: [16, 1, 1] },
    ]);
    expect(getWgslComputeEntryPoints("@compute @workgroup_size(4, 2)\nfn b() {}")).toEqual([
      { name: "b", workgroupSize: [4, 2, 1] },
    ]);
    expect(getWgslComputeEntryPoints("@compute\nfn c() {}")).toEqual([
      { name: "c", workgroupSize: [1, 1, 1] },
    ]);
  });

  it("finds multiple entries and ignores commented-out ones", () => {
    const entries = getWgslComputeEntryPoints(
      "// @compute @workgroup_size(8, 8, 1)\n// fn commentedOut() {}\n/* @compute fn blockCommented() {} */\n@compute @workgroup_size(2, 2, 2)\nfn first() {}\n@workgroup_size(4) @compute\nfn second() {}",
    );
    expect(entries).toEqual([
      { name: "first", workgroupSize: [2, 2, 2] },
      { name: "second", workgroupSize: [4, 1, 1] },
    ]);
  });

  it("ignores nested block comments", () => {
    const entries = getWgslComputeEntryPoints(
      "/* outer /* @compute fn hidden() {} */ still comment */\n@compute @workgroup_size(1, 1, 1)\nfn visible() {}",
    );
    expect(entries).toEqual([{ name: "visible", workgroupSize: [1, 1, 1] }]);
  });

  it("rejects zero workgroup sizes", () => {
    expect(getWgslComputeEntryPoints("@compute @workgroup_size(8, 0, 1)\nfn bad() {}")).toEqual([]);
  });
});

describe("injectComputeInit", () => {
  const ENTRY = "@compute @workgroup_size(8, 8, 1)\nfn mainCompute(@builtin(global_invocation_id) id: vec3<u32>) {\n  let x = 1;\n}";

  it("inserts the init call immediately after the entry's opening brace", () => {
    expect(injectComputeInit(ENTRY, "mainCompute")).toBe(
      "@compute @workgroup_size(8, 8, 1)\nfn mainCompute(@builtin(global_invocation_id) id: vec3<u32>) { _ss_initGlobals();\n  let x = 1;\n}",
    );
  });

  it("skips comments and strings when locating the brace", () => {
    const source = "// a comment with { brace\nfn mainCompute(/* { in comment */ id: vec3<u32> /* } */) { /* { */\n}";
    expect(injectComputeInit(source, "mainCompute")).toContain(") { _ss_initGlobals(); /* { */");
  });

  it("handles multi-line parameter lists", () => {
    const source = "fn mainCompute(\n  id: vec3<u32>,\n  dt: f32,\n) {\n}";
    expect(injectComputeInit(source, "mainCompute")).toContain(") { _ss_initGlobals();\n}");
  });

  it("does not match a name that merely contains the entry name", () => {
    const source = "fn mainComputeExtra() {\n}\nfn mainCompute() {\n}";
    const injected = injectComputeInit(source, "mainCompute");
    expect(injected).toContain("fn mainCompute() { _ss_initGlobals();");
    expect(injected).not.toContain("mainComputeExtra() { _ss_initGlobals();");
  });

  it("leaves source without the entry untouched", () => {
    const source = "fn other() {\n}";
    expect(injectComputeInit(source, "mainCompute")).toBe(source);
  });
});

describe("wrapWgslComputeSource", () => {
  const COMPUTE = "@compute @workgroup_size(8, 8, 1)\nfn mainCompute(@builtin(global_invocation_id) id: vec3<u32>) {\n  writeOutput(id.xy, vec4<f32>(1.0));\n}";
  const OPTIONS = { workgroupSize: [8, 8, 1] as [number, number, number], outputLayers: 1, hasOutput: true };

  it("injects global initialisation into the user entry point", () => {
    const { source } = wrapWgslComputeSource(COMPUTE, OPTIONS);
    expect(source).toContain("fn mainCompute(@builtin(global_invocation_id) id: vec3<u32>) { _ss_initGlobals();");
  });

  it("omits implicit sampling in compute instead of substituting level zero", () => {
    const { source } = wrapWgslComputeSource(COMPUTE, { ...OPTIONS, channels: [channel("iChannel0", 0)] });
    expect(source).not.toContain("textureSample(");
    expect(source).toContain("textureSampleLevel(");
    expect(source).not.toContain("fn iChannel0Sample(");
  });

  it("emits the storage output texture with WGSL format tokens", () => {
    const { source } = wrapWgslComputeSource(COMPUTE, OPTIONS);
    expect(source).toContain("var _ss_outTex: texture_storage_2d<rgba16float, write>;");
    expect(source).toContain("fn writeOutput(coord: vec2<u32>, color: vec4<f32>)");
    expect(source).toContain("textureStore(_ss_outTex, vec2<u32>(coord.x, dims.y - 1u - coord.y), color);");
    const float32 = wrapWgslComputeSource(COMPUTE, { ...OPTIONS, outputImageFormat: "rgba32f" }).source;
    expect(float32).toContain("texture_storage_2d<rgba32float, write>;");
  });

  it("emits the layered output variant for multi-layer passes", () => {
    const { source } = wrapWgslComputeSource(COMPUTE, { ...OPTIONS, outputLayers: 2 });
    expect(source).toContain("var _ss_outTex: texture_storage_2d_array<rgba16float, write>;");
    expect(source).toContain("fn writeOutput(coord: vec2<u32>, layer: u32, color: vec4<f32>)");
    expect(source).toContain("textureNumLayers(_ss_outTex)");
  });

  it("emits the dispatch uniform with init wired through _ss_initGlobals", () => {
    const { source } = wrapWgslComputeSource(COMPUTE, OPTIONS);
    expect(source).toContain("struct _ss_DispatchUniforms { dispatch: vec4<i32>, }");
    expect(source).toContain("var<uniform> _ss_dsp: _ss_DispatchUniforms;");
    expect(source).toContain("var<private> iDispatch: i32;");
    expect(source).toContain("iDispatch = _ss_dsp.dispatch.x;");
  });
});

describe("wrapWgslImageSource capture mode", () => {
  const IMAGE = "fn mainImage(coord: vec2<f32>) -> vec4<f32> { return vec4<f32>(coord.x); }";

  it("matches the fixed capture uniform byte layout", () => {
    const { source } = wrapWgslImageSource(IMAGE, { captureMode: true });
    expect(DBG_CAPTURE_UNIFORM_SIZE).toBe(32);
    const actual = wgslStructOffsets(source, "_ss_DbgCaptureUniforms");
    expect(actual.get("coordGrid")).toBe(DBG_CAPTURE_OFFSETS.coordGrid);
    expect(actual.get("varIndex")).toBe(DBG_CAPTURE_OFFSETS.varIndex);
    expect(actual.get("isPixelMode")).toBe(DBG_CAPTURE_OFFSETS.isPixelMode);
  });

  it("routes the capture entry through the requested coordinate", () => {
    const { source } = wrapWgslImageSource(IMAGE, { captureMode: true });
    expect(source).toContain("var<private> _ss_dbgVarIndex: i32;");
    expect(source).toContain("_ss_dbgVarIndex = _ss_dbgCapU.varIndex;");
    const fragment = source.slice(source.indexOf("@fragment fn fragmentMain"));
    expect(fragment).toContain("if (_ss_dbgCapU.isPixelMode != 0) { coord = _ss_dbgCapU.coordGrid.xy; }");
    expect(fragment).toContain("return mainImage(coord);");
  });
});

describe("WgslPrelude wrap metadata", () => {
  it("reports the real prelude line count before user source", () => {
    const userSource = "fn mainImage(coord: vec2<f32>) -> vec4<f32> {\n  return vec4<f32>(0.0);\n}";
    const { source, preludeLineCount, requiredFeatures } = wrapWgslImageSource(userSource, {
      channels: [channel("iChannel0", 0)],
      customUniforms: [{ name: "u", type: "float" }],
      commonCode: "fn helper() {}",
    });
    const userStart = source.indexOf("fn mainImage");
    expect(source.slice(0, userStart).split("\n").length - 1).toBe(preludeLineCount);
    expect(requiredFeatures).toEqual([]);
  });

  it("reports zero required features until Phase 6 directive hoisting lands", () => {
    expect(wrapWgslImageSource("fn mainImage(coord: vec2<f32>) -> vec4<f32> { return vec4<f32>(0.0); }").requiredFeatures).toEqual([]);
  });
});

describe("wrapWgslImageSource golden module", () => {
  it("assembles the full module for a representative shader", () => {
    const { source, preludeLineCount } = wrapWgslImageSource(
      "fn mainImage(coord: vec2<f32>) -> vec4<f32> {\n  let c = iChannel0Sample(coord);\n  return c * myGain;\n}",
      {
        channels: [
          { key: "iChannel0", slot: 0, kind: "texture", textureIdentity: "t0", samplerIdentity: "s0" },
          { key: "iChannel1", slot: 1, kind: "texture", textureIdentity: "t1", samplerIdentity: "s1" },
          { key: "iChannel2", slot: 2, kind: "cubemap", textureIdentity: "t2", samplerIdentity: "s2" },
          { key: "iChannel3", slot: 3, kind: "texture", textureIdentity: "t3", samplerIdentity: "s3" },
        ],
        storage: [
          { name: "particles", binding: 0, elementType: "float4", builtin: true, count: 256, stride: 16 },
          { name: "custom", binding: 1, elementType: "MyData", builtin: false, count: 16, stride: 32 },
        ],
        customUniforms: [
          { name: "myGain", type: "vec4" },
          { name: "myFlag", type: "bool" },
        ],
        commonCode: "fn helper(x: f32) -> f32 { return x * 2.0; }",
      },
    );

    expect(preludeLineCount).toBe(source.split("\n").findIndex(line => line.startsWith("fn mainImage(")));
    expect(source).toMatchInlineSnapshot(`
      "// ---- shader-studio WGSL prelude (generated) ----
      struct _ss_ShaderToyUniforms {
        resolution: vec4<f32>,
        mouse: vec4<f32>,
        time: f32,
        timeDelta: f32,
        frameRate: f32,
        frame: i32,
        channelTime: array<vec4<f32>, 4>,
        channelLoaded: array<vec4<f32>, 4>,
        sampleRate: vec4<f32>,
        date: vec4<f32>,
        channelResolution: array<vec4<f32>, 4>,
        cameraPos: vec4<f32>,
        cameraDir: vec4<f32>,
        vertexCount: vec4<u32>,
        viewMatrix: mat4x4<f32>,
        projectionMatrix: mat4x4<f32>,
        viewProjection: mat4x4<f32>,
        custom_myGain: vec4<f32>,
        custom_myFlag: i32,
      }

      @group(0) @binding(0) var<uniform> _ss_u: _ss_ShaderToyUniforms;
      var<private> iResolution: vec3<f32>;
      var<private> iMouse: vec4<f32>;
      var<private> iTime: f32;
      var<private> iTimeDelta: f32;
      var<private> iFrameRate: f32;
      var<private> iFrame: i32;
      var<private> iSampleRate: f32;
      var<private> iDate: vec4<f32>;
      var<private> iCameraPos: vec3<f32>;
      var<private> iCameraDir: vec3<f32>;
      var<private> iVertexCount: u32;
      var<private> iInstanceCount: u32;
      var<private> iViewMatrix: mat4x4<f32>;
      var<private> iProjectionMatrix: mat4x4<f32>;
      var<private> iViewProjection: mat4x4<f32>;
      var<private> iInstanceIndex: u32;
      var<private> iVertexUv: vec2<f32>;
      var<private> iWorldPosition: vec3<f32>;
      var<private> iNormal: vec3<f32>;
      var<private> iCameraPosition: vec3<f32>;
      var<private> iFrontFacing: bool;
      var<private> myGain: vec4<f32>;
      var<private> myFlag: bool;

      fn _ss_initGlobals() {
        iResolution = _ss_u.resolution.xyz;
        iMouse = _ss_u.mouse;
        iTime = _ss_u.time;
        iTimeDelta = _ss_u.timeDelta;
        iFrameRate = _ss_u.frameRate;
        iFrame = _ss_u.frame;
        iSampleRate = _ss_u.sampleRate.x;
        iDate = _ss_u.date;
        iCameraPos = _ss_u.cameraPos.xyz;
        iCameraDir = _ss_u.cameraDir.xyz;
        iVertexCount = _ss_u.vertexCount.x;
        iInstanceCount = _ss_u.vertexCount.y;
        iViewMatrix = _ss_u.viewMatrix;
        iProjectionMatrix = _ss_u.projectionMatrix;
        iViewProjection = _ss_u.viewProjection;
        myGain = _ss_u.custom_myGain;
        myFlag = _ss_u.custom_myFlag != 0;
        _ss_initChannels();
      }

      struct _ss_ChannelMetadata { size: vec2<u32>, time: f32, loaded: bool }
      fn sample2D(texture: texture_2d<f32>, sampling: sampler, uv: vec2f) -> vec4<f32> {
        return textureSample(texture, sampling, vec2f(uv.x, 1.0 - uv.y));
      }
      fn sample2DLevel(texture: texture_2d<f32>, sampling: sampler, uv: vec2f, lod: f32) -> vec4<f32> {
        return textureSampleLevel(texture, sampling, vec2f(uv.x, 1.0 - uv.y), lod);
      }
      fn sample2DGrad(texture: texture_2d<f32>, sampling: sampler, uv: vec2f, dx: vec2f, dy: vec2f) -> vec4<f32> {
        return textureSampleGrad(texture, sampling, vec2f(uv.x, 1.0 - uv.y), vec2f(dx.x, -dx.y), vec2f(dy.x, -dy.y));
      }
      fn sampleCube(texture: texture_cube<f32>, sampling: sampler, dir: vec3f) -> vec4<f32> {
        return textureSample(texture, sampling, dir);
      }
      fn sampleCubeLevel(texture: texture_cube<f32>, sampling: sampler, dir: vec3f, lod: f32) -> vec4<f32> {
        return textureSampleLevel(texture, sampling, dir, lod);
      }
      fn sampleCubeGrad(texture: texture_cube<f32>, sampling: sampler, dir: vec3f, dx: vec3f, dy: vec3f) -> vec4<f32> {
        return textureSampleGrad(texture, sampling, dir, dx, dy);
      }
      fn load2D(texture: texture_2d<f32>, pixel: vec2i) -> vec4f {
        let size = textureDimensions(texture, 0);
        return textureLoad(texture, vec2i(pixel.x, i32(size.y) - 1 - pixel.y), 0);
      }
      @group(0) @binding(1) var iChannel0Texture: texture_2d<f32>;
      @group(0) @binding(3) var iChannel1Texture: texture_2d<f32>;
      @group(0) @binding(5) var iChannel2Texture: texture_cube<f32>;
      @group(0) @binding(7) var iChannel3Texture: texture_2d<f32>;
      @group(0) @binding(2) var iChannel0Sampler: sampler;
      @group(0) @binding(4) var iChannel1Sampler: sampler;
      @group(0) @binding(6) var iChannel2Sampler: sampler;
      @group(0) @binding(8) var iChannel3Sampler: sampler;
      var<private> iChannel0: _ss_ChannelMetadata;
      fn iChannel0Sample(uv: vec2<f32>) -> vec4<f32> {
        return textureSample(iChannel0Texture, iChannel0Sampler, vec2<f32>(uv.x, 1.0 - uv.y));
      }
      fn iChannel0Load(pixel: vec2i) -> vec4f {
        return load2D(iChannel0Texture, pixel);
      }
      fn iChannel0SampleLevel(uv: vec2<f32>, lod: f32) -> vec4<f32> {
        return textureSampleLevel(iChannel0Texture, iChannel0Sampler, vec2<f32>(uv.x, 1.0 - uv.y), lod);
      }
      fn iChannel0SampleGrad(uv: vec2<f32>, dx: vec2<f32>, dy: vec2<f32>) -> vec4<f32> {
        return textureSampleGrad(iChannel0Texture, iChannel0Sampler, vec2<f32>(uv.x, 1.0 - uv.y), vec2<f32>(dx.x, -dx.y), vec2<f32>(dy.x, -dy.y));
      }
      fn iChannel0Size() -> vec2<u32> { return iChannel0.size; }
      fn iChannel0Time() -> f32 { return iChannel0.time; }
      fn iChannel0Loaded() -> bool { return iChannel0.loaded; }
      var<private> iChannel1: _ss_ChannelMetadata;
      fn iChannel1Sample(uv: vec2<f32>) -> vec4<f32> {
        return textureSample(iChannel1Texture, iChannel1Sampler, vec2<f32>(uv.x, 1.0 - uv.y));
      }
      fn iChannel1Load(pixel: vec2i) -> vec4f {
        return load2D(iChannel1Texture, pixel);
      }
      fn iChannel1SampleLevel(uv: vec2<f32>, lod: f32) -> vec4<f32> {
        return textureSampleLevel(iChannel1Texture, iChannel1Sampler, vec2<f32>(uv.x, 1.0 - uv.y), lod);
      }
      fn iChannel1SampleGrad(uv: vec2<f32>, dx: vec2<f32>, dy: vec2<f32>) -> vec4<f32> {
        return textureSampleGrad(iChannel1Texture, iChannel1Sampler, vec2<f32>(uv.x, 1.0 - uv.y), vec2<f32>(dx.x, -dx.y), vec2<f32>(dy.x, -dy.y));
      }
      fn iChannel1Size() -> vec2<u32> { return iChannel1.size; }
      fn iChannel1Time() -> f32 { return iChannel1.time; }
      fn iChannel1Loaded() -> bool { return iChannel1.loaded; }
      var<private> iChannel2: _ss_ChannelMetadata;
      fn iChannel2Sample(dir: vec3<f32>) -> vec4<f32> {
        return textureSample(iChannel2Texture, iChannel2Sampler, dir);
      }
      fn iChannel2SampleLevel(dir: vec3<f32>, lod: f32) -> vec4<f32> {
        return textureSampleLevel(iChannel2Texture, iChannel2Sampler, dir, lod);
      }
      fn iChannel2SampleGrad(dir: vec3<f32>, dx: vec3<f32>, dy: vec3<f32>) -> vec4<f32> {
        return textureSampleGrad(iChannel2Texture, iChannel2Sampler, dir, dx, dy);
      }
      fn iChannel2Size() -> vec2<u32> { return iChannel2.size; }
      fn iChannel2Time() -> f32 { return iChannel2.time; }
      fn iChannel2Loaded() -> bool { return iChannel2.loaded; }
      var<private> iChannel3: _ss_ChannelMetadata;
      fn iChannel3Sample(uv: vec2<f32>) -> vec4<f32> {
        return textureSample(iChannel3Texture, iChannel3Sampler, vec2<f32>(uv.x, 1.0 - uv.y));
      }
      fn iChannel3Load(pixel: vec2i) -> vec4f {
        return load2D(iChannel3Texture, pixel);
      }
      fn iChannel3SampleLevel(uv: vec2<f32>, lod: f32) -> vec4<f32> {
        return textureSampleLevel(iChannel3Texture, iChannel3Sampler, vec2<f32>(uv.x, 1.0 - uv.y), lod);
      }
      fn iChannel3SampleGrad(uv: vec2<f32>, dx: vec2<f32>, dy: vec2<f32>) -> vec4<f32> {
        return textureSampleGrad(iChannel3Texture, iChannel3Sampler, vec2<f32>(uv.x, 1.0 - uv.y), vec2<f32>(dx.x, -dx.y), vec2<f32>(dy.x, -dy.y));
      }
      fn iChannel3Size() -> vec2<u32> { return iChannel3.size; }
      fn iChannel3Time() -> f32 { return iChannel3.time; }
      fn iChannel3Loaded() -> bool { return iChannel3.loaded; }
      fn _ss_initChannels() {
        iChannel0.size = vec2<u32>(_ss_u.channelResolution[0].xy);
        iChannel0.time = _ss_u.channelTime[0].x;
        iChannel0.loaded = _ss_u.channelLoaded[0].x != 0.0;
        iChannel1.size = vec2<u32>(_ss_u.channelResolution[1].xy);
        iChannel1.time = _ss_u.channelTime[1].x;
        iChannel1.loaded = _ss_u.channelLoaded[1].x != 0.0;
        iChannel2.size = vec2<u32>(_ss_u.channelResolution[2].xy);
        iChannel2.time = _ss_u.channelTime[2].x;
        iChannel2.loaded = _ss_u.channelLoaded[2].x != 0.0;
        iChannel3.size = vec2<u32>(_ss_u.channelResolution[3].xy);
        iChannel3.time = _ss_u.channelTime[3].x;
        iChannel3.loaded = _ss_u.channelLoaded[3].x != 0.0;
      }

      @group(0) @binding(9) var<storage, read> particles: array<vec4<f32>>;
      fn helper(x: f32) -> f32 { return x * 2.0; }

      fn mainImage(coord: vec2<f32>) -> vec4<f32> {
        let c = iChannel0Sample(coord);
        return c * myGain;
      }
      @group(0) @binding(10) var<storage, read> custom: array<MyData>;
      fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {}

      struct _ss_VertexUvOut {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
      }

      @vertex fn vertexMain(@builtin(vertex_index) vid: u32) -> _ss_VertexUvOut {
        var verts = array<vec2<f32>, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
        var output: _ss_VertexUvOut;
        output.position = vec4<f32>(verts[vid], 0.0, 1.0);
        output.uv = verts[vid] * 0.5 + 0.5;
        return output;
      }

      @fragment fn fragmentMain(@builtin(position) fragCoord: vec4<f32>, @location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
        _ss_initGlobals();
        iVertexUv = uv;
        iFrontFacing = true;
        // Flip Y so fragCoord origin is bottom-left, matching ShaderToy.
        return mainImage(vec2<f32>(fragCoord.x, _ss_u.resolution.y - fragCoord.y));
      }
      "
    `);
  });
});
