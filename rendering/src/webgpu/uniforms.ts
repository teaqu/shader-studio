import { SHADERTOY_UNIFORM_SIZE } from "./SlangPrelude";

/** The per-frame inputs the Slang ShaderToy uniform block needs. */
export interface ShaderToyUniformInput {
  width: number;
  height: number;
  time: number;
  timeDelta: number;
  frameRate: number;
  frame: number;
  mouse: ArrayLike<number>; // [x, y, z, w]
}

/**
 * Pack inputs into the std140 byte layout the generated WGSL expects. Writes
 * floats and the one int into a single ArrayBuffer at fixed offsets (see
 * UNIFORM_OFFSETS in SlangPrelude). The struct has no interior padding because
 * every field is naturally aligned.
 */
export function packShaderToyUniforms(input: ShaderToyUniformInput): ArrayBuffer {
  const buf = new ArrayBuffer(SHADERTOY_UNIFORM_SIZE);
  const f32 = new Float32Array(buf);
  const i32 = new Int32Array(buf);

  // iResolution : float4 @ 0  (xyz used; z = pixel aspect = 1)
  f32[0] = input.width;
  f32[1] = input.height;
  f32[2] = 1;
  f32[3] = 0;

  // iMouse : float4 @ 16  (index 16/4 = 4)
  f32[4] = input.mouse[0] ?? 0;
  f32[5] = input.mouse[1] ?? 0;
  f32[6] = input.mouse[2] ?? 0;
  f32[7] = input.mouse[3] ?? 0;

  f32[8] = input.time; // iTime @ 32
  f32[9] = input.timeDelta; // iTimeDelta @ 36
  f32[10] = input.frameRate; // iFrameRate @ 40
  i32[11] = input.frame | 0; // iFrame @ 44

  return buf;
}
