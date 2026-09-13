import { wgslStorageElementType } from "@shader-studio/types";
import { buildSlangBindingPlan } from "./SlangBindingPlan";
import type { StorageBindingNode } from "../types/PassGraph";
import { buildChannelSamplingFunctions, describeSlangChannel, type GeometryType } from "@shader-studio/types";
import {
  getShaderToyChannelCount,
  isSlangCustomUniformType,
  type SlangChannelBinding,
  type SlangCustomUniformInfo,
} from "./SlangPrelude";
import { isMeshGeometry, MESH_FRAGMENT_CONTEXT } from "../preview3d/MeshFragmentContext";
import type { WgslVertexRange, WgslDirectiveRange } from "./wgslDiagnostics";
import { getWgslComputeEntryPoints, parseWgslDocument, symbolAtPosition, tokenizeWgsl } from "@shader-studio/wgsl-analysis";

export { getWgslComputeEntryPoints } from "@shader-studio/wgsl-analysis";

// WGSL authoring convention for the WebGPU pipeline.
//
// A user `.wgsl` image shader defines:
//
//     fn mainImage(coord: vec2<f32>) -> vec4<f32> { ... }
//
// and may read the globals `iResolution` (vec3<f32>), `iTime`, `iTimeDelta`,
// `iFrameRate`, `iFrame`, `iMouse` (vec4<f32>) — same semantics as ShaderToy.
//
// We wrap that source with a prelude (the uniform block plus `var<private>`
// globals initialised by `_ss_initGlobals()`) and two entry points (a
// fullscreen-triangle vertex shader and a fragment shader that calls
// mainImage). WGSL has no `#line`, so `preludeLineCount` lets diagnostics map
// assembled-module lines back onto user lines (Phase 5).

export const WGSL_ENTRY_VERTEX = "vertexMain";
export const WGSL_ENTRY_FRAGMENT = "fragmentMain";

export interface WgslWrapOptions {
  passName?: string;
  commonCode?: string;
  channels?: SlangChannelBinding[];
  storage?: StorageBindingNode[];
  passKind?: "render" | "compute";
  geometry?: GeometryType;
  vertexCode?: string;
  customUniforms?: SlangCustomUniformInfo[];
  /**
   * Variable-capture mode: adds the capture uniform block and swaps the
   * fragment entry for one that remaps fragCoord before calling mainImage.
   */
  captureMode?: boolean;
}

export interface WgslComputeWrapOptions {
  passName?: string;
  commonCode?: string;
  channels?: SlangChannelBinding[];
  storage?: StorageBindingNode[];
  workgroupSize: [number, number, number];
  outputLayers: number;
  hasOutput: boolean;
  customUniforms?: SlangCustomUniformInfo[];
  /** WGSL image format for compute output texture: "rgba16f" (default) or "rgba32f". */
  outputImageFormat?: "rgba16f" | "rgba32f";
  /** Entry to inject `_ss_initGlobals()` into; defaults to every discovered entry. */
  entryPoint?: string;
}

export interface WgslWrapResult {
  /** The assembled module. */
  source: string;
  /** Lines of generated code preceding the user's line 1. Needed for diagnostics. */
  preludeLineCount: number;
  /**
   * Lines of user source in the assembled module (after directive hoisting,
   * which preserves line numbers, and compute init injection). Diagnostics
   * past preludeLineCount + userLineCount sit in generated entry points.
   */
  userLineCount: number;
  /**
   * Assembled-module range of the user vertex hook, when the pass has one.
   * Absent for capture mode and for passes without a hook.
   */
  vertexRange?: WgslVertexRange;
  /** Authored Common source placement, including its leading blank lines. */
  commonRange?: WgslVertexRange;
  directiveRanges?: WgslDirectiveRange[];
  /** `enable`/`requires` directives hoisted out of user source (Phase 6). */
  requiredFeatures: string[];
}

/**
 * `enable` extension name → the `GPUFeatureName` the device must have been
 * created with. Extensions absent here need no feature: they are core WGSL
 * (`pointer_composite_access`) or unknown to us (leave those to the driver).
 */
export const WGSL_ENABLE_TO_GPU_FEATURE: Record<string, string> = {
  f16: "shader-f16",
  dual_source_blending: "dual-source-blending",
  clip_distances: "clip-distances",
  subgroups: "subgroups",
};

/** Every GPU feature the engine may request up front (spec 7.2, option A). */
export const WGSL_KNOWN_GPU_FEATURES = [
  "float32-filterable",
  "shader-f16",
  "dual-source-blending",
  "clip-distances",
  "subgroups",
];

/**
 * Friendly pre-driver error when a shader's hoisted `enable` names need a GPU
 * feature the device lacks. Returns undefined when everything is supported.
 */
export function wgslUnsupportedFeatureMessage(
  requiredFeatures: string[],
  hasFeature: (feature: string) => boolean,
): string | undefined {
  for (const enable of requiredFeatures) {
    const feature = WGSL_ENABLE_TO_GPU_FEATURE[enable];
    if (feature === undefined || hasFeature(feature)) {
      continue;
    }
    return `WGSL: this shader requires ${enable}, which this GPU does not support`;
  }
  return undefined;
}

const WGSL_CUSTOM_UNIFORM_TYPES: Record<string, string> = {
  float: "f32",
  vec2: "vec2<f32>",
  vec3: "vec3<f32>",
  vec4: "vec4<f32>",
  bool: "i32",
};

/**
 * Fixed uniform block. Byte offsets must reproduce `createShaderToyUniformLayout`:
 * in the `uniform` address space array stride is a multiple of 16, so the
 * channel arrays are `array<vec4<f32>, N>` indexed `.x` (`.xyz` for resolution).
 */
function buildUniformPrelude(channelCount: number, customUniforms: SlangCustomUniformInfo[] = []): string {
  const customFields = customUniforms
    .flatMap(({ name, type }) => isSlangCustomUniformType(type)
      ? [`  custom_${name}: ${WGSL_CUSTOM_UNIFORM_TYPES[type]},`]
      : [])
    .join("\n");
  return `// ---- shader-studio WGSL prelude (generated) ----
struct _ss_ShaderToyUniforms {
  resolution: vec4<f32>,
  mouse: vec4<f32>,
  time: f32,
  timeDelta: f32,
  frameRate: f32,
  frame: i32,
  channelTime: array<vec4<f32>, ${channelCount}>,
  channelLoaded: array<vec4<f32>, ${channelCount}>,
  sampleRate: vec4<f32>,
  date: vec4<f32>,
  channelResolution: array<vec4<f32>, ${channelCount}>,
  cameraPos: vec4<f32>,
  cameraDir: vec4<f32>,
${customFields}
}

@group(0) @binding(0) var<uniform> _ss_u: _ss_ShaderToyUniforms;
`;
}

interface WgslGlobalOptions {
  dispatch?: boolean;
  capture?: boolean;
  channels?: SlangChannelBinding[];
}

/**
 * Module-scope `var<private>` globals initialised at the top of every entry
 * point, so users write bare `iTime` / `iResolution` exactly as in Slang.
 * Deduplicated public resource handles are linked separately with token/source positions.
 */
function buildGlobalsPrelude(customUniforms: SlangCustomUniformInfo[] = [], options: WgslGlobalOptions = {}): string {
  const declarations = [
    "var<private> iResolution: vec3<f32>;",
    "var<private> iMouse: vec4<f32>;",
    "var<private> iTime: f32;",
    "var<private> iTimeDelta: f32;",
    "var<private> iFrameRate: f32;",
    "var<private> iFrame: i32;",
    "var<private> iSampleRate: f32;",
    "var<private> iDate: vec4<f32>;",
    "var<private> iCameraPos: vec3<f32>;",
    "var<private> iCameraDir: vec3<f32>;",
    `var<private> ${MESH_FRAGMENT_CONTEXT.worldPosition}: vec3<f32>;`,
    `var<private> ${MESH_FRAGMENT_CONTEXT.normal}: vec3<f32>;`,
    `var<private> ${MESH_FRAGMENT_CONTEXT.cameraPosition}: vec3<f32>;`,
  ];
  const initialisers = [
    "  iResolution = _ss_u.resolution.xyz;",
    "  iMouse = _ss_u.mouse;",
    "  iTime = _ss_u.time;",
    "  iTimeDelta = _ss_u.timeDelta;",
    "  iFrameRate = _ss_u.frameRate;",
    "  iFrame = _ss_u.frame;",
    "  iSampleRate = _ss_u.sampleRate.x;",
    "  iDate = _ss_u.date;",
    "  iCameraPos = _ss_u.cameraPos.xyz;",
    "  iCameraDir = _ss_u.cameraDir.xyz;",
  ];
  for (const { name, type } of customUniforms) {
    if (!isSlangCustomUniformType(type)) {
      continue;
    }
    declarations.push(`var<private> ${name}: ${type === "bool" ? "bool" : WGSL_CUSTOM_UNIFORM_TYPES[type]};`);
    initialisers.push(type === "bool"
      ? `  ${name} = _ss_u.custom_${name} != 0;`
      : `  ${name} = _ss_u.custom_${name};`);
  }
  if (options.channels?.length) {
    initialisers.push("  _ss_initChannels();");
  }
  if (options.dispatch) {
    declarations.push("var<private> iDispatch: i32;");
    initialisers.push("  iDispatch = _ss_dsp.dispatch.x;");
  }
  if (options.capture) {
    declarations.push("var<private> _ss_dbgVarIndex: i32;");
    initialisers.push("  _ss_dbgVarIndex = _ss_dbgCapU.varIndex;");
  }
  return `${declarations.join("\n")}

fn _ss_initGlobals() {
${initialisers.join("\n")}
}
`;
}

interface WgslChannelAccessors {
  key: string;
  slot: number;
  textureVar: string;
  samplerVar: string;
  cube: boolean;
}

function channelAccessors(channel: WgslChannelAccessors, fragmentStage: boolean): string {
  const { key, slot, textureVar, samplerVar, cube } = channel;
  const coordType = cube ? "vec3<f32>" : "vec2<f32>";
  const coordName = cube ? "dir" : "uv";
  // Mirror describeSlangChannel: 2D sampling flips Y for the ShaderToy
  // bottom-left origin (and negates gradients); cubemaps sample unflipped.
  const sampleCoord = cube ? coordName : `vec2<f32>(${coordName}.x, 1.0 - ${coordName}.y)`;
  const grad = (name: string) => cube ? name : `vec2<f32>(${name}.x, -${name}.y)`;
  const methods = describeSlangChannel(cube ? 'texture-cube' : 'texture-2d').methods;
  const implicit = methods.find(method => method.name === 'Sample');
  const sample = implicit && (fragmentStage || !implicit.requiresFragment)
    ? `fn ${key}Sample(${coordName}: ${coordType}) -> vec4<f32> {
  return textureSample(${textureVar}, ${samplerVar}, ${sampleCoord});
}` : '';
  return `${sample}
fn ${key}SampleLevel(${coordName}: ${coordType}, lod: f32) -> vec4<f32> {
  return textureSampleLevel(${textureVar}, ${samplerVar}, ${sampleCoord}, lod);
}
fn ${key}SampleGrad(${coordName}: ${coordType}, dx: ${coordType}, dy: ${coordType}) -> vec4<f32> {
  return textureSampleGrad(${textureVar}, ${samplerVar}, ${sampleCoord}, ${grad("dx")}, ${grad("dy")});
}
fn ${key}Size() -> vec2<u32> { return ${key}.size; }
fn ${key}Time() -> f32 { return ${key}.time; }
fn ${key}Loaded() -> bool { return ${key}.loaded; }`;
}

/** Shortest public name is the canonical handle, so linking can preserve columns. */
function publicChannelHandles(channels: SlangChannelBinding[]) {
  const plan = buildSlangBindingPlan(channels);
  const textures = new Map<number, string>();
  const samplers = new Map<number, string>();
  for (const channel of [...plan.channels].sort((a, b) => a.key.length - b.key.length || a.slot - b.slot)) {
    if (!textures.has(channel.textureBinding)) {
      textures.set(channel.textureBinding, `${channel.key}Texture`);
    }
    if (!samplers.has(channel.samplerBinding)) {
      samplers.set(channel.samplerBinding, `${channel.key}Sampler`);
    }
  }
  return { plan, textures, samplers };
}

/**
 * Link generated handle aliases to one resource binding without changing WGSL grammar.
 * Padding preserves every original line/column. Resolve authored symbols first so
 * local shadowing and structure members keep their own meaning; comments are tokens' gaps.
 */
function linkChannelHandles(result: WgslWrapResult, channels: SlangChannelBinding[]): WgslWrapResult {
  const { plan, textures, samplers } = publicChannelHandles(channels);
  const aliases = new Map<string, string>();
  for (const channel of plan.channels) {
    for (const [alias, canonical] of [[`${channel.key}Texture`, textures.get(channel.textureBinding)!], [`${channel.key}Sampler`, samplers.get(channel.samplerBinding)!]]) {
      if (alias !== canonical) {
        aliases.set(alias!, canonical!);
      }
    }
  }
  if (!aliases.size) {
    return result;
  }
  const analysis = parseWgslDocument('file:///shader.wgsl', result.source, 'fragment');
  const tokens = tokenizeWgsl(result.source);
  let source = result.source;
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index]!;
    const canonical = aliases.get(token.text);
    if (!canonical || token.kind !== 'identifier' || tokens[index - 1]?.text === '.') {
      continue;
    }
    if (symbolAtPosition(analysis, { line: token.line, character: token.character })) {
      continue;
    }
    source = source.slice(0, token.offset) + canonical.padEnd(token.text.length) + source.slice(token.offset + token.text.length);
  }
  return { ...result, source };
}

/**
 * Channel texture/sampler declarations plus per-channel free-function
 * accessors. `var` declarations are emitted once per binding (deduplicated
 * like buildSlangChannels); accessors are emitted once per channel name.
 * Compute passes omit fragment-only `textureSample`.
 */
function buildChannelPrelude(channels: SlangChannelBinding[] = [], fragmentStage = true): string {
  if (channels.length === 0) {
    return "";
  }
  const { plan, textures: textureVarByBinding, samplers: samplerVarByBinding } = publicChannelHandles(channels);
  const sorted = [...plan.channels].sort((a, b) => a.slot - b.slot);
  const lines: string[] = [
    'struct _ss_ChannelMetadata { size: vec2<u32>, time: f32, loaded: bool }',
    buildChannelSamplingFunctions(sorted.map(channel => channel.kind === 'cubemap' ? 'texture-cube' : 'texture-2d'), 'wgsl', fragmentStage),
  ];
  for (const texture of plan.textures) {
    const textureVar = textureVarByBinding.get(texture.binding)!;
    lines.push(`@group(0) @binding(${texture.binding}) var ${textureVar}: ${texture.kind === 'cubemap' ? 'texture_cube<f32>' : 'texture_2d<f32>'};`);
  }
  for (const sampler of plan.samplers) {
    lines.push(`@group(0) @binding(${sampler.binding}) var ${samplerVarByBinding.get(sampler.binding)!}: sampler;`);
  }
  const init: string[] = [];
  for (const channel of sorted) {
    lines.push(`var<private> ${channel.key}: _ss_ChannelMetadata;`);
    init.push(`  ${channel.key}.size = vec2<u32>(_ss_u.channelResolution[${channel.slot}].xy);`,
      `  ${channel.key}.time = _ss_u.channelTime[${channel.slot}].x;`,
      `  ${channel.key}.loaded = _ss_u.channelLoaded[${channel.slot}].x != 0.0;`);
    lines.push(channelAccessors({
      key: channel.key, slot: channel.slot,
      textureVar: textureVarByBinding.get(channel.textureBinding)!,
      samplerVar: samplerVarByBinding.get(channel.samplerBinding)!,
      cube: channel.kind === 'cubemap',
    }, fragmentStage));
  }
  lines.push(`fn _ss_initChannels() {\n${init.join('\n')}\n}`);
  return `${lines.join('\n')}\n`;
}

/** Build storage declarations split around common code by their type dependency. */
export function buildWgslStorageDeclarations(
  storage: StorageBindingNode[],
  channelCount: number,
  passKind: "render" | "compute",
  baseBinding = 1 + channelCount * 2,
): { beforeCommon: string; afterCommon: string } {
  const access = passKind === "compute" ? "read_write" : "read";
  const declaration = (node: StorageBindingNode) => {
    const element = wgslStorageElementType(node.elementType, passKind);
    return `@group(0) @binding(${baseBinding + node.binding}) var<storage, ${access}> ${node.name}: array<${element}>;\n`;
  };
  return {
    beforeCommon: storage.filter((node) => node.builtin).map(declaration).join(""),
    afterCommon: storage.filter((node) => !node.builtin).map(declaration).join(""),
  };
}

function buildMeshPrelude(binding: number): string {
  return `// ---- shader-studio WGSL mesh prelude (generated) ----
struct _ss_MeshUniforms {
  model: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
  normalMatrix: mat4x4<f32>,
  cameraPosition: vec4<f32>,
}

@group(0) @binding(${binding}) var<uniform> _ss_mesh: _ss_MeshUniforms;
`;
}

const WGSL_VERTEX_HOOK = "fn mainVertex(position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>)";

/** An entry-point block plus where the user vertex hook landed inside it. */
export interface WgslEntryPoints {
  source: string;
  /** 1-based line of the hook's first line within source. The hook always leads. */
  vertexStartLine: number;
  /** Lines of user hook code. 0 when the generated stub stands in. */
  vertexLineCount: number;
}

function buildMeshEntryPoints(vertexCode: string): WgslEntryPoints {
  const hook = vertexCode.trim() ? vertexCode : "";
  const hookSource = hook === "" ? `${WGSL_VERTEX_HOOK} {}` : hook;
  return {
    source: `${hookSource}
struct _ss_MeshVertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) worldPosition: vec3<f32>,
  @location(2) normal: vec3<f32>,
}

@vertex fn ${WGSL_ENTRY_VERTEX}(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>) -> _ss_MeshVertexOut {
  _ss_initGlobals();
  var p = position;
  var n = normal;
  var t = uv;
  mainVertex(&p, &n, &t);
  let worldPosition = _ss_mesh.model * vec4<f32>(p, 1.0);
  var output: _ss_MeshVertexOut;
  output.position = _ss_mesh.viewProjection * worldPosition;
  output.uv = t;
  output.worldPosition = worldPosition.xyz;
  output.normal = (_ss_mesh.normalMatrix * vec4<f32>(n, 0.0)).xyz;
  return output;
}

@fragment fn ${WGSL_ENTRY_FRAGMENT}(@location(0) uv: vec2<f32>, @location(1) worldPos: vec3<f32>, @location(2) normal: vec3<f32>) -> @location(0) vec4<f32> {
  _ss_initGlobals();
  ${MESH_FRAGMENT_CONTEXT.worldPosition} = worldPos;
  ${MESH_FRAGMENT_CONTEXT.normal} = normal;
  ${MESH_FRAGMENT_CONTEXT.cameraPosition} = _ss_mesh.cameraPosition.xyz;
  return mainImage(uv * _ss_u.resolution.xy);
}
`,
    vertexStartLine: 1,
    vertexLineCount: hook === "" ? 0 : hookSource.split("\n").length,
  };
}

function buildFullscreenEntryPoints(vertexCode: string): WgslEntryPoints {
  const hook = vertexCode.trim() ? vertexCode : "";
  if (hook !== "") {
    return {
      source: `${hook}
@vertex fn ${WGSL_ENTRY_VERTEX}(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  _ss_initGlobals();
  var verts = array<vec2<f32>, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var position = vec3<f32>(verts[vid], 0.0);
  var normal = vec3<f32>(0.0, 0.0, 1.0);
  var uv = verts[vid] * 0.5 + 0.5;
  mainVertex(&position, &normal, &uv);
  return vec4<f32>(position, 1.0);
}

@fragment fn ${WGSL_ENTRY_FRAGMENT}(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  _ss_initGlobals();
  return mainImage(vec2<f32>(fragCoord.x, _ss_u.resolution.y - fragCoord.y));
}
`,
      vertexStartLine: 1,
      vertexLineCount: hook.split("\n").length,
    };
  }
  return {
    source: `${WGSL_VERTEX_HOOK} {}

@vertex fn ${WGSL_ENTRY_VERTEX}(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  var verts = array<vec2<f32>, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4<f32>(verts[vid], 0.0, 1.0);
}

@fragment fn ${WGSL_ENTRY_FRAGMENT}(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  _ss_initGlobals();
  // Flip Y so fragCoord origin is bottom-left, matching ShaderToy.
  return mainImage(vec2<f32>(fragCoord.x, _ss_u.resolution.y - fragCoord.y));
}
`,
    vertexStartLine: 1,
    vertexLineCount: 0,
  };
}

// Capture uniform block layout (bytes): coordGrid vec4<f32> @0
// (xy = capture coord in ShaderToy fragCoord space, zw = grid size),
// varIndex i32 @16, isPixelMode i32 @20, padding to 32.
// Sizes stay in lockstep with DBG_CAPTURE_UNIFORM_SIZE / DBG_CAPTURE_OFFSETS.
function buildCapturePrelude(captureBinding: number): string {
  return `// ---- shader-studio WGSL capture prelude (generated) ----
struct _ss_DbgCaptureUniforms {
  coordGrid: vec4<f32>,
  varIndex: i32,
  isPixelMode: i32,
  _pad: vec2<i32>,
}

@group(0) @binding(${captureBinding}) var<uniform> _ss_dbgCapU: _ss_DbgCaptureUniforms;
`;
}

const CAPTURE_ENTRY_POINTS = `// ---- shader-studio WGSL capture entry points (generated) ----
@vertex fn ${WGSL_ENTRY_VERTEX}(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  var verts = array<vec2<f32>, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4<f32>(verts[vid], 0.0, 1.0);
}

@fragment fn ${WGSL_ENTRY_FRAGMENT}(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  _ss_initGlobals();
  var coord = fragCoord.xy / _ss_dbgCapU.coordGrid.zw * _ss_u.resolution.xy;
  if (_ss_dbgCapU.isPixelMode != 0) { coord = _ss_dbgCapU.coordGrid.xy; }
  return mainImage(coord);
}
`;

function buildOutputPrelude(binding: number, outputLayers: number, imageFormat: "rgba16f" | "rgba32f" = "rgba16f"): string {
  const format = imageFormat === "rgba32f" ? "rgba32float" : "rgba16float";
  if (outputLayers > 1) {
    return `// ---- shader-studio WGSL compute output (generated) ----
@group(0) @binding(${binding}) var _ss_outTex: texture_storage_2d_array<${format}, write>;

fn writeOutput(coord: vec2<u32>, layer: u32, color: vec4<f32>) {
  let dims = textureDimensions(_ss_outTex);
  if (coord.x >= dims.x || coord.y >= dims.y || layer >= textureNumLayers(_ss_outTex)) { return; }
  textureStore(_ss_outTex, vec2<u32>(coord.x, dims.y - 1u - coord.y), layer, color);
}
`;
  }
  return `// ---- shader-studio WGSL compute output (generated) ----
@group(0) @binding(${binding}) var _ss_outTex: texture_storage_2d<${format}, write>;

fn writeOutput(coord: vec2<u32>, color: vec4<f32>) {
  let dims = textureDimensions(_ss_outTex);
  if (coord.x >= dims.x || coord.y >= dims.y) { return; }
  textureStore(_ss_outTex, vec2<u32>(coord.x, dims.y - 1u - coord.y), color);
}
`;
}

function buildDispatchPrelude(binding: number): string {
  return `// ---- shader-studio WGSL dispatch prelude (generated) ----
struct _ss_DispatchUniforms { dispatch: vec4<i32>, }

@group(0) @binding(${binding}) var<uniform> _ss_dsp: _ss_DispatchUniforms;
`;
}

/**
 * Masks comments and string literals with spaces, preserving newlines and
 * byte offsets. WGSL block comments nest, so a depth counter replaces the
 * non-nesting regex Slang uses. Shared with the pass graph until Phase 8
 * extracts the wgsl-analysis package.
 */
export function maskWgslNonCode(source: string): string {
  const masked = source.split("");
  let index = 0;
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      if (masked[i] !== "\n") {
        masked[i] = " ";
      }
    }
  };
  while (index < masked.length) {
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      blank(index, end === -1 ? masked.length : end);
      index = end === -1 ? masked.length : end;
    } else if (source.startsWith("/*", index)) {
      let depth = 0;
      const start = index;
      while (index < masked.length) {
        if (source.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (source.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
          if (depth === 0) {
            break;
          }
        } else {
          index += 1;
        }
      }
      blank(start, index);
    } else if (source[index] === '"') {
      const start = index;
      index += 1;
      while (index < masked.length && source[index] !== '"' && source[index] !== "\n") {
        index += source[index] === "\\" ? 2 : 1;
      }
      blank(start, Math.min(index + 1, masked.length));
    } else {
      index += 1;
    }
  }
  return masked.join("");
}

/**
 * Injects `_ss_initGlobals();` after the entry function's opening brace.
 * Comments and strings are masked before scanning (offsets preserved), and
 * the entry name must match whole — `mainComputeExtra` never matches
 * `mainCompute`. Sources without the entry are returned unchanged; pass-graph
 * validation reports the missing entry.
 */
export function injectComputeInit(source: string, entryName: string): string {
  const masked = maskWgslNonCode(source);
  const header = new RegExp(`fn\\s+${entryName}(?![A-Za-z0-9_])`).exec(masked);
  if (!header) {
    return source;
  }
  let index = header.index + header[0].length;
  while (index < masked.length && masked[index] !== "(") {
    index += 1;
  }
  let depth = 0;
  while (index < masked.length) {
    if (masked[index] === "(") {
      depth += 1;
    } else if (masked[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
    index += 1;
  }
  while (index < masked.length && masked[index] !== "{") {
    index += 1;
  }
  if (index >= masked.length) {
    return source;
  }
  // Keep authored lines intact so compiler diagnostics retain their source line.
  return `${source.slice(0, index + 1)} _ss_initGlobals();${source.slice(index + 1)}`;
}

function countLines(text: string): number {
  return text.split("\n").length - 1;
}

export interface WgslHoistedDirectives {
  /** Deduplicated directive statements in first-appearance order. */
  directives: string[];
  locations: { text: string; sourceStartLine: number }[];
  /** Deduplicated `enable` extension names in first-appearance order. */
  enableNames: string[];
  /** Source with each hoisted directive blanked (newlines kept, so lines hold). */
  stripped: string;
}

const WGSL_DIRECTIVE_PATTERN = /\benable\s+[^;]*;|\brequires\s+[^;]*;|diagnostic\s*\([^;]*\)\s*;/g;
const WGSL_DIRECTIVE_PRECEDER = /[A-Za-z0-9_.@]/;
const WGSL_ENABLE_NAMES = /^enable\s+([^;]+);\s*$/;

/**
 * Pulls module-scope `enable` / `requires` / `diagnostic()` directives out of
 * user source so the wrapper can emit them above the prelude (WGSL requires
 * directives to precede every declaration). Comments and strings are masked
 * before scanning, hoisted text is blanked rather than deleted so user line
 * numbers survive, and duplicates collapse to one. Directives nested inside
 * braces (e.g. a function-body `diagnostic()`) stay where they are.
 */
export function extractWgslDirectives(source: string): WgslHoistedDirectives {
  const masked = maskWgslNonCode(source);
  const blanked = source.split("");
  const directives: string[] = [];
  const locations: WgslHoistedDirectives["locations"] = [];
  const seen = new Set<string>();
  const enableNames: string[] = [];
  const enableSeen = new Set<string>();
  for (const match of masked.matchAll(WGSL_DIRECTIVE_PATTERN)) {
    const index = match.index ?? 0;
    const text = match[0];
    if (/[{}]/.test(text)) {
      continue;
    }
    if (index > 0 && WGSL_DIRECTIVE_PRECEDER.test(masked[index - 1]!)) {
      continue;
    }
    let depth = 0;
    for (let i = 0; i < index; i++) {
      if (masked[i] === "{") {
        depth += 1;
      } else if (masked[i] === "}") {
        depth -= 1;
      }
    }
    if (depth !== 0) {
      continue;
    }
    for (let i = index; i < index + text.length; i++) {
      if (blanked[i] !== "\n") {
        blanked[i] = " ";
      }
    }
    const key = text.replace(/\s+/g, " ").trim();
    if (!seen.has(key)) {
      seen.add(key);
      directives.push(key);
      const prefix = source.slice(0, index);
      locations.push({
        text: " ".repeat(index - (source.lastIndexOf("\n", index - 1) + 1)) + source.slice(index, index + text.length),
        sourceStartLine: countLines(prefix) + 1,
      });
    }
    const enableList = WGSL_ENABLE_NAMES.exec(key)?.[1];
    if (enableList !== undefined) {
      for (const name of enableList.split(",").map((part) => part.trim())) {
        if (/^[A-Za-z_]\w*$/.test(name) && !enableSeen.has(name)) {
          enableSeen.add(name);
          enableNames.push(name);
        }
      }
    }
  }
  return { directives, locations, enableNames, stripped: blanked.join("") };
}

/** Hoists directives from authored pass, Common and vertex sources, deduplicated. */
function hoistWgslDirectives(userSource: string, commonCode: string, vertexSource = ""): {
  userSource: string;
  commonCode: string;
  vertexSource: string;
  header: string;
  enableNames: string[];
  directiveRanges: WgslDirectiveRange[];
} {
  const user = extractWgslDirectives(userSource);
  const common = extractWgslDirectives(commonCode);
  const vertex = extractWgslDirectives(vertexSource);
  const seen = new Set<string>();
  const enableNames = new Set<string>();
  const directiveRanges: WgslDirectiveRange[] = [];
  let header = "";
  for (const [owner, extracted] of [["Image", user], ["Common", common], ["vertex", vertex]] as const) {
    extracted.directives.forEach((key, index) => {
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      const location = extracted.locations[index]!;
      directiveRanges.push({ startLine: countLines(header) + 1, lineCount: countLines(location.text) + 1,
        sourceStartLine: location.sourceStartLine, owner });
      header += `${location.text}\n`;
    });
    for (const name of extracted.enableNames) {
      enableNames.add(name);
    }
  }
  return { userSource: user.stripped, commonCode: common.stripped, vertexSource: vertex.stripped,
    header, enableNames: [...enableNames], directiveRanges };
}

/** Wrap a user image-shader source into a full, compilable WGSL module. */
function assembleWgslImageSource(userSource: string, options: WgslWrapOptions = {}): WgslWrapResult {
  const channels = options.channels ?? [];
  const channelCount = getShaderToyChannelCount(channels);
  const prelude = buildUniformPrelude(channelCount, options.customUniforms)
    + buildGlobalsPrelude(options.customUniforms, { capture: options.captureMode, channels });
  const hoisted = hoistWgslDirectives(
    userSource,
    options.commonCode ?? "",
    options.vertexCode ?? "",
  );
  const strippedCommonCode = hoisted.commonCode;
  const commonCode = strippedCommonCode ? `${strippedCommonCode}\n` : "";
  const strippedUserSource = hoisted.userSource;
  const channelPrelude = buildChannelPrelude(channels);
  const plan = buildSlangBindingPlan(channels);
  const storageDeclarations = buildWgslStorageDeclarations(
    options.storage ?? [],
    channels.length,
    options.passKind ?? "render",
    plan.nextBinding,
  );
  const prefix = `${hoisted.header}${prelude}\n${channelPrelude}\n${storageDeclarations.beforeCommon}`;
  if (options.captureMode) {
    // Capture uniforms bind after the channel texture/sampler pairs and storage buffers.
    const captureBinding = plan.nextBinding + (options.storage?.length ?? 0);
    const capturePrelude = buildCapturePrelude(captureBinding);
    const body = `${prefix}${commonCode}${storageDeclarations.afterCommon}${capturePrelude}`;
    return {
      source: `${body}\n${strippedUserSource}\n${CAPTURE_ENTRY_POINTS}`,
      preludeLineCount: countLines(body) + 1,
      userLineCount: strippedUserSource.split("\n").length,
      ...commonRangeOf(prefix, strippedCommonCode),
      requiredFeatures: hoisted.enableNames,
      directiveRanges: hoisted.directiveRanges,
    };
  }
  const vertexCode = hoisted.vertexSource;
  if (isMeshGeometry(options.geometry)) {
    const meshBinding = plan.nextBinding + (options.storage?.length ?? 0);
    const body = `${prefix}${buildMeshPrelude(meshBinding)}${commonCode}`;
    const head = `${body}\n${strippedUserSource}\n${storageDeclarations.afterCommon}`;
    const entries = buildMeshEntryPoints(vertexCode);
    return {
      source: `${head}${entries.source}`,
      preludeLineCount: countLines(body) + 1,
      userLineCount: strippedUserSource.split("\n").length,
      ...commonRangeOf(`${prefix}${buildMeshPrelude(meshBinding)}`, strippedCommonCode),
      ...vertexRangeOf(head, entries),
      requiredFeatures: hoisted.enableNames,
      directiveRanges: hoisted.directiveRanges,
    };
  }
  const body = `${prefix}${commonCode}`;
  const head = `${body}\n${strippedUserSource}\n${storageDeclarations.afterCommon}`;
  const entries = buildFullscreenEntryPoints(vertexCode);
  return {
    source: `${head}${entries.source}`,
    preludeLineCount: countLines(body) + 1,
    userLineCount: strippedUserSource.split("\n").length,
    ...commonRangeOf(prefix, strippedCommonCode),
    ...vertexRangeOf(head, entries),
    requiredFeatures: hoisted.enableNames,
    directiveRanges: hoisted.directiveRanges,
  };
}

function commonRangeOf(prefix: string, common: string): Pick<WgslWrapResult, "commonRange"> {
  return common.length === 0 ? {} : {
    commonRange: { startLine: countLines(prefix) + 1, lineCount: common.split("\n").length },
  };
}

/**
 * Locates the user hook in assembled-module lines. The entry block is appended
 * to `head`, which always ends in a newline, so the block starts on the fresh
 * line after head's last newline. No range when the stub stands in.
 */
function vertexRangeOf(
  head: string,
  entries: WgslEntryPoints,
): Pick<WgslWrapResult, "vertexRange"> {
  if (entries.vertexLineCount === 0) {
    return {};
  }
  return {
    vertexRange: {
      startLine: countLines(head) + entries.vertexStartLine,
      lineCount: entries.vertexLineCount,
    },
  };
}

/** Wrap a user compute-shader source into a full, compilable WGSL module. */
function assembleWgslComputeSource(userSource: string, options: WgslComputeWrapOptions): WgslWrapResult {
  const channels = options.channels ?? [];
  const storage = options.storage ?? [];
  const channelCount = getShaderToyChannelCount(channels);
  const prelude = buildUniformPrelude(channelCount, options.customUniforms)
    + buildGlobalsPrelude(options.customUniforms, { dispatch: true, channels });
  const hoisted = hoistWgslDirectives(
    userSource,
    options.commonCode ?? "",
  );
  const strippedCommonCode = hoisted.commonCode;
  const commonCode = strippedCommonCode ? `${strippedCommonCode}\n` : "";
  const strippedUserSource = hoisted.userSource;
  const channelPrelude = buildChannelPrelude(channels, false);
  const plan = buildSlangBindingPlan(channels);
  const storageDeclarations = buildWgslStorageDeclarations(storage, channels.length, "compute", plan.nextBinding);
  const outputBinding = plan.nextBinding + storage.length;
  const outputPrelude = options.hasOutput
    ? buildOutputPrelude(outputBinding, options.outputLayers, options.outputImageFormat ?? "rgba16f")
    : "";
  const dispatchBinding = outputBinding + (options.hasOutput ? 1 : 0);
  const dispatchPrelude = buildDispatchPrelude(dispatchBinding);
  const entries = options.entryPoint ? [options.entryPoint] : getWgslComputeEntryPoints(strippedUserSource).map((entry) => entry.name);
  let injectedUserSource = strippedUserSource;
  for (const entry of entries) {
    injectedUserSource = injectComputeInit(injectedUserSource, entry);
  }
  const body = `${hoisted.header}${prelude}\n${channelPrelude}\n${storageDeclarations.beforeCommon}${outputPrelude}${dispatchPrelude}${commonCode}`;
  return {
    source: `${body}\n${injectedUserSource}\n${storageDeclarations.afterCommon}`,
    preludeLineCount: countLines(body) + 1,
    userLineCount: injectedUserSource.split("\n").length,
    ...commonRangeOf(body.slice(0, body.length - commonCode.length), strippedCommonCode),
    requiredFeatures: hoisted.enableNames,
    directiveRanges: hoisted.directiveRanges,
  };
}

export function wrapWgslImageSource(userSource: string, options: WgslWrapOptions = {}): WgslWrapResult {
  return linkChannelHandles(assembleWgslImageSource(userSource, options), options.channels ?? []);
}

export function wrapWgslComputeSource(userSource: string, options: WgslComputeWrapOptions): WgslWrapResult {
  return linkChannelHandles(assembleWgslComputeSource(userSource, options), options.channels ?? []);
}
