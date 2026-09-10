// Precision accumulation history buffer for WGSL/WebGPU.
// WGSL mirror of ../slang/backend-differences/precision/history.slang.

fn mainImage(coord: vec2f) -> vec4f {
    let previous = iChannel0Sample(coord / iResolution.xy).r;
    return vec4f(previous + 0.0001, 0.0, 0.0, 1.0);
}
