// Raw-workgroups display for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/raw-workgroups.slang. A single
// 1x1x1 dispatch of 1x1x1 threads covers one texel: expect a mostly
// untouched frame with a single marked texel.

fn mainImage(coord: vec2f) -> vec4f {
    return iChannel0Sample(coord / iResolution.xy);
}
