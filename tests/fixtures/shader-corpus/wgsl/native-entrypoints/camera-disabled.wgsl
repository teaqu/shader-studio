// mainVertex puts cube vertices inside WebGPU clip space; viewer transforms are disabled.
fn mainVertex(position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) { *position *= 0.65; }
@fragment fn cameraColor(@location(0) uv: vec2f, @location(1) worldPosition: vec3f, @location(2) normal: vec3f) -> @location(0) vec4f {
  let unitNormal = normalize(normal);
  let faceTint = abs(unitNormal) * 0.6;
  let gradient = vec3f(uv * 0.3, 0.1);
  let color = faceTint + gradient;
  return vec4f(color, 1.0);
}
