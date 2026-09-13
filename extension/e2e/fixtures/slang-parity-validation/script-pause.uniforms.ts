// Driven by the host's own clock, not ctx: if the script keeps running while
// the shader is paused, the picture keeps changing.
export function uniforms() {
  return { uTick: (Date.now() % 2000) / 2000 };
}
