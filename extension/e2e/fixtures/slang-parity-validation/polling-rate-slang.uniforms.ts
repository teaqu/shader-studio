// Separate from the GLSL fixture so parallel workers never write the same
// config or script while exercising persistence.
export function uniforms() {
  return { uLevel: (Date.now() % 2000) / 2000 };
}
