struct CameraVaryings {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) normal: vec3f,
}

@vertex fn cameraVertex(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
) -> CameraVaryings {
  let world = iModelMatrix * vec4f(position, 1.0);
  let transformedNormal = (iNormalMatrix * vec4f(normal, 0.0)).xyz;
  return CameraVaryings(iViewProjectionMatrix * world, uv, transformedNormal);
}

@fragment fn cameraColor(input: CameraVaryings) -> @location(0) vec4f {
  let brightness = 0.30 + 0.70 * max(0.0, dot(normalize(input.normal), normalize(vec3f(0.4, 0.6, 0.7))));
  return vec4f((0.25 + 0.75 * input.uv.x) * abs(input.normal) * brightness, 1.0);
}
