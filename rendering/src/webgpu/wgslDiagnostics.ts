/**
 * WGSL rejects implicit-LOD sampling (and derivatives) reached through
 * non-uniform control flow. ShaderToy-style shaders do it constantly — a
 * channel read behind an `if (id == 1)` is ordinary GLSL — so ports otherwise
 * have to fall back on explicit level-0 sampling, which ignores the mip chain
 * and reads full-size texels: several times slower per frame, and worse as
 * resolution grows.
 *
 * The WGSL spec's own escape hatch is a module-scope diagnostic filter, which
 * restores GL behaviour: derivatives come from the 2x2 quad and the mip level
 * is chosen automatically, exactly as `texture()` does in the GLSL engine.
 */
const DERIVATIVE_UNIFORMITY_FILTER = "diagnostic(off, derivative_uniformity);";

const EXISTING_FILTER = /diagnostic\s*\(\s*[A-Za-z_]\w*\s*,\s*derivative_uniformity\s*\)/;

/**
 * Prefix generated WGSL with the derivative-uniformity filter. Directives may
 * appear in any order before the first declaration, so the filter goes at the
 * top; a module that already carries one is returned untouched.
 */
export function allowNonUniformDerivatives(wgsl: string): string {
  if (EXISTING_FILTER.test(wgsl)) {
    return wgsl;
  }
  return `${DERIVATIVE_UNIFORMITY_FILTER}\n${wgsl}`;
}
