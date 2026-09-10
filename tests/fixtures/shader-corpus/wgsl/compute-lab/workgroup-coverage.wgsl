// Workgroup-coverage display for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/workgroup-coverage.slang. A fixed raw
// dispatch covers the full image at [16, 8, 1]; lower sizes visibly leave
// part of the output untouched.

fn mainImage(coord: vec2f) -> vec4f {
    return iChannel0Sample(coord / iResolution.xy);
}
