// Channel-cover display for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/channel-cover.slang. ComputeCovered
// covers the live dimensions of ComputeSource's output texture.

fn mainImage(coord: vec2f) -> vec4f {
    return iChannel0Sample(coord / iResolution.xy);
}
