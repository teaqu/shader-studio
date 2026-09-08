// Reports back what the script was told about the shader, so the shader itself
// can check the two agree. A host that invents the context - a wall clock, a
// fixed 800x600, a zero mouse - disagrees and the fixture turns black.
export function uniforms(ctx: any) {
  return {
    uWidth: ctx.iResolution[0],
    uTime: ctx.iTime,
    uMouseX: ctx.iMouse[0],
  };
}
