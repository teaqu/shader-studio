// Multi-entry display for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/multi-entry.slang. Two compute passes
// share multi-entry-kernels.wgsl and select clearSamples / animateSamples
// independently via entryPoint.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let index = min(u32(uv.x * 256.0), 255u);
    let value = samples[index];
    return vec4f(value, 0.25 + 0.75 * (1.0 - value), 1.0 - value, 1.0);
}
