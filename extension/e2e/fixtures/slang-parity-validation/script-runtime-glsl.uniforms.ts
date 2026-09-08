let calls = 0;
export function uniforms(ctx: { iFrameRate: number; iFrame: number }) {
  return { uLevel: 0.75, uCalls: ++calls, uFps: ctx.iFrameRate, uFrame: ctx.iFrame };
}
