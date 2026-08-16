interface UniformContext {
  iTime: number;
}

type UniformValue =
  | number
  | boolean
  | [number, number]
  | [number, number, number]
  | [number, number, number, number];

export function uniforms(ctx: UniformContext): Record<string, UniformValue> {
  const phase = ctx.iTime;
  return {
    uFloat: 0.5 + 0.5 * Math.sin(phase * 1.3),
    uVec2: [
      0.5 + 0.5 * Math.sin(phase * 0.9),
      0.5 + 0.5 * Math.cos(phase * 1.1),
    ],
    uVec3: [
      0.5 + 0.5 * Math.sin(phase),
      0.5 + 0.5 * Math.sin(phase + 2.094),
      0.5 + 0.5 * Math.sin(phase + 4.189),
    ],
    uVec4: [
      0.5 + 0.5 * Math.cos(phase * 0.7),
      0.25,
      0.85,
      0.5 + 0.5 * Math.sin(phase * 1.7),
    ],
    uBool: Math.floor(phase) % 2 === 0,
  };
}
