// Axis-coded KTX2 volume: blue changes as the sampled depth moves.
fn mainImage(fragCoord: vec2f) -> vec4f {
  let uv = fragCoord / iResolution.xy;
  return iChannel0SampleLevel(vec3f(uv, 0.5 + 0.4 * sin(iTime)), 0.0);
}
