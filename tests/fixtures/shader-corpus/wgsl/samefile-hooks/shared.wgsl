// Legacy hooks may live together in one WGSL file. No `vertex` path is needed.
fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
  (*position).xy = (*position).xy * 0.72;
}

fn mainImage(coord: vec2f) -> vec4f {
  let uv = coord / iResolution.xy;
  return vec4f(uv.x, uv.y, 0.6, 1.0);
}
