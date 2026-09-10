// Fullscreen ripple vertex test for WGSL/WebGPU.
// WGSL mirror of ../slang/fullscreen-vertex.slang.
//
// No geometry is configured, so the hook edits the fullscreen triangle in
// place: expect a gently wobbling fullscreen gradient. A static image means
// the custom vertex stage is not running.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3f(0.0, 2.0, 4.0));
    return vec4f(col, 1.0);
}
