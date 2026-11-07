import type { PointerState } from "@shader-studio/types";
import { DEFAULT_INSTANCE_COUNT, VR_CONTROLLER_FIELDS } from "@shader-studio/types";
import { parseScriptUniformType } from "@shader-studio/types";
import type { VrControllerData } from "../webxr/WebXrFrameData";
import {
  createShaderToyUniformLayout,
  type ShaderToyUniformLayout,
  isSlangCustomUniformType,
  type SlangCustomUniformInfo,
  type SlangCustomUniformType,
} from "./SlangPrelude";

export interface SlangCustomUniformValue extends SlangCustomUniformInfo {
  value: number | number[] | boolean;
}

export interface SlangCustomUniformLayoutEntry {
  name: string;
  type: SlangCustomUniformType;
  offset: number;
}

export interface SlangCustomUniformLayout {
  entries: SlangCustomUniformLayoutEntry[];
  size: number;
}

const CUSTOM_LAYOUT: Record<string, { alignment: number; size: number }> = {
  float: { alignment: 4, size: 4 },
  int: { alignment: 4, size: 4 },
  uint: { alignment: 4, size: 4 },
  vec2: { alignment: 8, size: 8 },
  vec3: { alignment: 16, size: 12 },
  vec4: { alignment: 16, size: 16 },
  bool: { alignment: 4, size: 4 },
};

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

export function createSlangCustomUniformLayout(
  uniformInfo: SlangCustomUniformInfo[] = [],
  channelCount = 4,
): SlangCustomUniformLayout {
  let offset = createShaderToyUniformLayout(channelCount).size;
  const entries: SlangCustomUniformLayoutEntry[] = [];
  for (const { name, type } of uniformInfo) {
    if (!isSlangCustomUniformType(type)) {
      continue;
    }
    const shape = parseScriptUniformType(type)!;
    const field = shape.length ? { alignment: 16, size: shape.length * 16 } : CUSTOM_LAYOUT[shape.base];
    offset = alignTo(offset, field.alignment);
    entries.push({ name, type, offset });
    offset += field.size;
  }
  return { entries, size: alignTo(offset, 16) };
}

/** mainVR dispatch and WebXR controller state; omitted fields are zero. */
export interface VrUniformInput {
  /** Desktop mainVR preview for the Image pass. */
  preview?: boolean;
  /** This draw renders one headset eye. */
  immersive?: boolean;
  /** An immersive session is running (iVRActive). */
  active?: boolean;
  viewport?: { x: number; y: number; width: number; height: number };
  /** Column-major right/up/forward ray basis and eye origin. */
  rayTransform?: ArrayLike<number>;
  controllers?: VrControllerData;
}

/** The per-frame inputs the Slang ShaderToy uniform block needs. */
export interface ShaderToyUniformInput {
  /** Must match the channel count used when this pass's Slang source was generated. */
  channelCount?: number;
  width: number;
  height: number;
  time: number;
  timeDelta: number;
  frameRate: number;
  frame: number;
  mouse: ArrayLike<number>;
  pointer?: PointerState;
  channelTime: ArrayLike<number>;
  channelLoaded: ArrayLike<number>;
  sampleRate: number;
  date: ArrayLike<number>;
  /** Tightly packed xyz vectors; the GPU block pads each to float4. */
  channelResolution: ArrayLike<number>;
  cameraPos: ArrayLike<number>;
  cameraDir: ArrayLike<number>;
  /** Vertices the pass draws (iVertexCount); defaults to 0 when not applicable. */
  vertexCount?: number;
  /** Instances the pass draws (iInstanceCount); defaults to 1. */
  instanceCount?: number;
  /** Column-major orbit-camera matrices; each defaults to the identity. */
  viewMatrix?: ArrayLike<number>;
  projectionMatrix?: ArrayLike<number>;
  viewProjection?: ArrayLike<number>;
  vr?: VrUniformInput;
}

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

function packVrUniforms(vr: VrUniformInput, offsets: ShaderToyUniformLayout["offsets"], f32: Float32Array, i32: Int32Array): void {
  const stateIndex = offsets.iVrState / 4;
  i32[stateIndex] = vr.preview ? 1 : 0;
  i32[stateIndex + 1] = vr.immersive ? 1 : 0;
  i32[stateIndex + 2] = vr.active ? 1 : 0;
  if (vr.viewport) {
    f32.set([vr.viewport.x, vr.viewport.y, vr.viewport.width, vr.viewport.height], offsets.iVrViewport / 4);
  }
  if (vr.rayTransform) {
    f32.set(vr.rayTransform, offsets.iVrRayTransform / 4);
  }
  const controllers = vr.controllers;
  if (controllers) {
    VR_CONTROLLER_FIELDS.forEach(({ data }, index) => {
      f32.set(controllers[data], (offsets.iVrControllers + index * 32) / 4);
    });
  }
}

/** Pack the fixed ShaderToy prefix followed by dynamically laid-out script uniforms. */
export function packShaderToyUniforms(
  input: ShaderToyUniformInput,
  customUniformInfo: SlangCustomUniformInfo[] = [],
  customUniformValues: SlangCustomUniformValue[] = [],
): ArrayBuffer {
  const layout = createShaderToyUniformLayout(input.channelCount ?? 4);
  const { channelCount, offsets } = layout;
  const customLayout = createSlangCustomUniformLayout(customUniformInfo, channelCount);
  const buf = new ArrayBuffer(customLayout.size);
  const f32 = new Float32Array(buf);
  const i32 = new Int32Array(buf);
  const u32 = new Uint32Array(buf);

  f32[0] = input.width;
  f32[1] = input.height;
  f32[2] = input.height === 0 ? 1 : input.width / input.height;

  for (let component = 0; component < 4; component++) {
    f32[4 + component] = input.mouse[component] ?? 0;
  }

  f32[8] = input.time;
  f32[9] = input.timeDelta;
  f32[10] = input.frameRate;
  i32[11] = input.frame | 0;

  for (let channel = 0; channel < channelCount; channel++) {
    f32[(offsets.iChannelTime + channel * 16) / 4] = input.channelTime[channel] ?? 0;
    f32[(offsets.iChannelLoaded + channel * 16) / 4] = input.channelLoaded[channel] ?? 0;
  }
  f32[offsets.iSampleRate / 4] = input.sampleRate;

  for (let component = 0; component < 4; component++) {
    f32[offsets.iDate / 4 + component] = input.date[component] ?? 0;
  }
  for (let channel = 0; channel < channelCount; channel++) {
    for (let component = 0; component < 3; component++) {
      f32[(offsets.iChannelResolution + channel * 16) / 4 + component] = input.channelResolution[channel * 3 + component] ?? 0;
    }
  }
  for (let component = 0; component < 3; component++) {
    f32[offsets.iCameraPos / 4 + component] = input.cameraPos[component] ?? 0;
    f32[offsets.iCameraDir / 4 + component] = input.cameraDir[component] ?? 0;
  }
  // iVertexCount and iInstanceCount share one 16-byte slot as its x and y.
  u32[offsets.iVertexCount / 4] = input.vertexCount ?? 0;
  u32[offsets.iVertexCount / 4 + 1] = input.instanceCount ?? DEFAULT_INSTANCE_COUNT;
  f32.set(input.viewMatrix ?? IDENTITY_MATRIX, offsets.iViewMatrix / 4);
  f32.set(input.projectionMatrix ?? IDENTITY_MATRIX, offsets.iProjectionMatrix / 4);
  f32.set(input.viewProjection ?? IDENTITY_MATRIX, offsets.iViewProjection / 4);

  const pointer = input.pointer;
  const pointerIndex = offsets.iPointer / 4;
  f32.set(pointer?.position ?? [0, 0], pointerIndex);
  i32[pointerIndex + 2] = pointer?.inside ?? 0;
  i32[pointerIndex + 3] = pointer?.held ?? 0;
  i32[pointerIndex + 4] = pointer?.pressed ?? 0;
  i32[pointerIndex + 5] = pointer?.released ?? 0;
  i32[pointerIndex + 6] = pointer?.modifiers ?? 0;
  f32.set(pointer?.wheel ?? [0, 0], pointerIndex + 8);
  f32.set(pointer?.wheelDelta ?? [0, 0], pointerIndex + 10);

  if (input.vr) {
    packVrUniforms(input.vr, offsets, f32, i32);
  }

  const valuesByName = new Map(customUniformValues.map((uniform) => [uniform.name, uniform.value]));
  for (const entry of customLayout.entries) {
    const value = valuesByName.get(entry.name);
    const index = entry.offset / 4;
    const shape = parseScriptUniformType(entry.type)!;
    if (shape.length) {
      const values = Array.isArray(value) ? value : [];
      const target = shape.base === 'uint' ? u32 : shape.base === 'int' ? i32 : f32;
      for (let item = 0; item < shape.length; item++) {
        target[index + item * 4] = values[item] ?? 0;
      }
    } else if (entry.type === 'uint' || entry.type === 'int') {
      (entry.type === 'uint' ? u32 : i32)[index] = typeof value === 'number' ? value : 0;
    } else if (entry.type === "bool") {
      i32[index] = value ? 1 : 0;
    } else if (entry.type === "float") {
      f32[index] = typeof value === "number" ? value : 0;
    } else {
      const components = Array.isArray(value) ? value : [];
      const count = CUSTOM_LAYOUT[entry.type].size / 4;
      for (let component = 0; component < count; component++) {
        f32[index + component] = components[component] ?? 0;
      }
    }
  }

  return buf;
}
