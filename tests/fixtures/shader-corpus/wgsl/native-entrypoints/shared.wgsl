// One WGSL module powers a compute pass, a buffer pass, and Image.
// Each pass selects just the stage functions named in shared.sha.json.

@vertex fn fullscreenVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(triangle[index], 0.0, 1.0);
}

@compute @workgroup_size(1)
fn advance(@builtin(global_invocation_id) id: vec3u) {
  if (id.x == 0u) { samples[0] = 0.35 + 0.15 * sin(iTime); }
}

@fragment fn bufferWarm() -> @location(0) vec4f {
  return vec4f(samples[0], 0.12, 0.04, 1.0);
}

@fragment fn bufferCool() -> @location(0) vec4f {
  return vec4f(0.04, samples[0], 0.38, 1.0);
}

@fragment fn present(@builtin(position) coord: vec4f) -> @location(0) vec4f {
  let uv = coord.xy / iResolution.xy;
  let buffer = iChannel0Sample(uv);
  return vec4f(buffer.b, buffer.g, buffer.r, 1.0);
}
