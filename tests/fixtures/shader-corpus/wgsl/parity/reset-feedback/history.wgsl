// Reset-feedback history buffer for WGSL/WebGPU.
// WGSL mirror of ../slang/parity/reset-feedback/history.slang.

fn mainImage(coord: vec2f) -> vec4f {
    let previous = iChannel0Sample(coord / iResolution.xy);
    if (iFrame == 0) {
        return select(vec4f(0.9, 0.0, 0.0, 1.0), vec4f(0.0, 0.8, 0.1, 1.0), length(previous.rgb) < 0.001);
    }
    return mix(previous, vec4f(0.05, 0.15, 0.9, 1.0), 0.025);
}
