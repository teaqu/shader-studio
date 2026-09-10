// Resize-feedback history buffer for WGSL/WebGPU.
// WGSL mirror of ../slang/parity/resize-feedback/history.slang.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let previous = iChannel0Sample(uv);
    // Fixed pixel coordinates make the resize contract unambiguous: feedback
    // preserves its absolute position relative to the bottom-left corner.
    let seed = select(0.0, 1.0, iFrame < 8 && length(coord - vec2f(64.0, 64.0)) < 18.0);
    return max(previous, vec4f(seed, seed, seed, 1.0));
}
