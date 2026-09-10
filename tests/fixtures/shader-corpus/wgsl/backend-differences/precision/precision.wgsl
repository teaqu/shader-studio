// Precision accumulation parity test for WGSL/WebGPU.
// WGSL mirror of ../slang/backend-differences/precision/precision.slang
// (with history.wgsl). Compares the feedback value against the expected
// frame-count ramp: green grows with error, so any red tint marks float
// accumulation diverging from the reference.

fn mainImage(coord: vec2f) -> vec4f {
    let value = iChannel0Sample(coord / iResolution.xy).r;
    let expected = f32(iFrame + 1) * 0.0001;
    let error = abs(value - expected);
    return vec4f(clamp(error * 2000.0, 0.0, 1.0), clamp(1.0 - error * 2000.0, 0.0, 1.0), 0.0, 1.0);
}
