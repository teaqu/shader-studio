export function uniforms(ctx: { iTime: number }) {
  return {
    uRed: 0.5 + 0.5 * Math.sin(ctx.iTime * 0.7),
    uGreen: 0.5 + 0.5 * Math.cos(ctx.iTime * 0.7),
    uOffset: ctx.iTime * 3.0,
  };
}
