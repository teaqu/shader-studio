// Each column checks every 256th uint32 word from the script producer.
// Green means continuous data; red means a sequence error was detected.
fn mainImage(coord: vec2f) -> vec4f {
  let uv = coord / iResolution.xy;
  let lane = min(255u, u32(uv.x * 256.0));
  let bad = volumeState[256u + lane] > 0u || volumeState[517] > 0u;
  var color = vec3f(0.015, 0.025, 0.06);
  if (uv.y > 0.15 && uv.y < 0.85) {
    let intensity = 0.4 + 0.6 * fract(f32(volumeState[lane]) / 8192.0);
    color = select(vec3f(0.05, 0.7, 0.65) * intensity, vec3f(1.0, 0.05, 0.08), bad);
  }
  // This uses the stream in the Image stage too; paused frames see length zero.
  if (uv.y > 0.9 && samples.length > 0u) { color = vec3f(0.7, 0.9, 1.0); }
  return vec4f(color, 1.0);
}
