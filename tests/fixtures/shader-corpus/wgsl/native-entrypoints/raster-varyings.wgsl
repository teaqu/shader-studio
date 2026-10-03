// Native raster debugging fixture: authored varyings plus structured color/depth output.

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) tint: vec3f,
}

struct FragmentOutput {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
}

// Cube mesh layout supplies position at location 0 (the complete stride is 32 bytes).
@vertex fn rasterVertex(@location(0) position: vec3f) -> Varyings {
  let point = position.xy * 2.0;
  let depth = position.z * 0.25 + 0.5;
  let uv = point * 0.5 + 0.5;
  return Varyings(vec4f(point, depth, 1.0), uv, vec3f(0.20, 0.55, 0.95));
}

@fragment fn rasterColor(input: Varyings) -> FragmentOutput {
  // Hover or select this value in the editor for inline preview and capture.
  let value = input.uv.x * input.tint;
  let depth = 0.20 + 0.60 * input.uv.y;
  return FragmentOutput(vec4f(value, 1.0), depth);
}
