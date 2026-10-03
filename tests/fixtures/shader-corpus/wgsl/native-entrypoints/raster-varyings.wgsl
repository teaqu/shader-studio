// Native raster debugging fixture: an inset, projected cube with authored varyings.

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) worldPosition: vec3f,
  @location(2) normal: vec3f,
}

struct FragmentOutput {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
}

// The standard cube mesh supplies position, normal, and UV at locations 0–2.
@vertex fn rasterVertex(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
) -> Varyings {
  // Apply the same viewer camera used by the built-in mesh vertex shader.
  let worldPosition = iModelMatrix * vec4f(position * 0.65, 1.0);
  let worldNormal = (iNormalMatrix * vec4f(normal, 0.0)).xyz;
  return Varyings(iViewProjectionMatrix * worldPosition, uv, worldPosition.xyz, worldNormal);
}

@fragment fn rasterColor(input: Varyings) -> FragmentOutput {
  let unitNormal = normalize(input.normal);
  let faceTint = vec3f(0.08)
    + max(unitNormal.x, 0.0) * vec3f(0.95, 0.16, 0.10)
    + max(-unitNormal.x, 0.0) * vec3f(0.18, 0.72, 0.22)
    + max(unitNormal.y, 0.0) * vec3f(0.92, 0.72, 0.12)
    + max(unitNormal.z, 0.0) * vec3f(0.12, 0.32, 0.95)
    + max(-unitNormal.z, 0.0) * vec3f(0.12, 0.32, 0.95);
  let light = 0.30 + 0.70 * max(0.0, dot(unitNormal, normalize(vec3f(0.4, 0.6, 0.7))));
  // Hover or select this value in the editor for inline preview and capture.
  let value = (0.20 + 0.80 * input.uv.x) * (faceTint + vec3f(0.12)) * light;
  return FragmentOutput(vec4f(value, 1.0), input.position.z);
}
