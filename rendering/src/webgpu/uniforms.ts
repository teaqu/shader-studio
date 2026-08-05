import {
  SHADERTOY_UNIFORM_SIZE,
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

const CUSTOM_LAYOUT: Record<SlangCustomUniformType, { alignment: number; size: number }> = {
  float: { alignment: 4, size: 4 },
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
): SlangCustomUniformLayout {
  let offset = SHADERTOY_UNIFORM_SIZE;
  const entries: SlangCustomUniformLayoutEntry[] = [];
  for (const { name, type } of uniformInfo) {
    if (!isSlangCustomUniformType(type)) {
      continue;
    }
    const field = CUSTOM_LAYOUT[type];
    offset = alignTo(offset, field.alignment);
    entries.push({ name, type, offset });
    offset += field.size;
  }
  return { entries, size: alignTo(offset, 16) };
}

/** The per-frame inputs the Slang ShaderToy uniform block needs. */
export interface ShaderToyUniformInput {
  width: number;
  height: number;
  time: number;
  timeDelta: number;
  frameRate: number;
  frame: number;
  mouse: ArrayLike<number>;
  channelTime: ArrayLike<number>;
  channelLoaded: ArrayLike<number>;
  sampleRate: number;
  date: ArrayLike<number>;
  /** Four tightly packed xyz vectors. The GPU block pads each to float4. */
  channelResolution: ArrayLike<number>;
  cameraPos: ArrayLike<number>;
  cameraDir: ArrayLike<number>;
}

/** Pack the fixed ShaderToy prefix followed by dynamically laid-out script uniforms. */
export function packShaderToyUniforms(
  input: ShaderToyUniformInput,
  customUniformInfo: SlangCustomUniformInfo[] = [],
  customUniformValues: SlangCustomUniformValue[] = [],
): ArrayBuffer {
  const customLayout = createSlangCustomUniformLayout(customUniformInfo);
  const buf = new ArrayBuffer(customLayout.size);
  const f32 = new Float32Array(buf);
  const i32 = new Int32Array(buf);

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

  for (let channel = 0; channel < 4; channel++) {
    f32[12 + channel] = input.channelTime[channel] ?? 0;
    f32[16 + channel] = input.channelLoaded[channel] ?? 0;
  }
  f32[20] = input.sampleRate;

  for (let component = 0; component < 4; component++) {
    f32[24 + component] = input.date[component] ?? 0;
  }
  for (let channel = 0; channel < 4; channel++) {
    for (let component = 0; component < 3; component++) {
      f32[28 + channel * 4 + component] = input.channelResolution[channel * 3 + component] ?? 0;
    }
  }
  for (let component = 0; component < 3; component++) {
    f32[44 + component] = input.cameraPos[component] ?? 0;
    f32[48 + component] = input.cameraDir[component] ?? 0;
  }

  const valuesByName = new Map(customUniformValues.map((uniform) => [uniform.name, uniform.value]));
  for (const entry of customLayout.entries) {
    const value = valuesByName.get(entry.name);
    const index = entry.offset / 4;
    if (entry.type === "bool") {
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
