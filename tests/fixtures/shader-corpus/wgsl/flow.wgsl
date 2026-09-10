// Image pass — composites BufferA (sharp paint) + BufferB (half-res glow).
//
// Channels (see flow.sha.json):
//   iChannel0 = BufferA  (sampled — current frame)
//   iChannel1 = BufferB  (sampled — current frame, half resolution)
//   iChannel2 = BufferA  (declared but NEVER sampled — exercises the
//                         explicit bind-group layout with an unused channel;
//                         must produce zero WebGPU validation errors)
//
// Orientation markers: RED bar must appear along the TOP edge and GREEN
// along the LEFT edge. If red shows at the bottom, the v-flip is wrong.
//
// WGSL mirror of ../flow.slang. Channels are free functions
// (`iChannel0Sample`), not methods — see wgsl/README.md.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;

    // `palette` comes from common.wgsl — proves common code reaches Image.
    var col = palette(uv.x * 0.2 + iTime * 0.02) * 0.06;

    let sharp = iChannel0Sample(uv).rgb;
    let glow = iChannel1Sample(uv).rgb;
    col += sharp + 0.6 * glow * glow;

    if (uv.y > 0.985) { col = vec3f(1.0, 0.0, 0.0); } // TOP edge = red
    if (uv.x < 0.008) { col = vec3f(0.0, 1.0, 0.0); } // LEFT edge = green

    return vec4f(col, 1.0);
}
