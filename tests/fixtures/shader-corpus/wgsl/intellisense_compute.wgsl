// Displays the output of compute-lab/passes/intellisense-compute.wgsl.
// WGSL mirror of ../slang/intellisense_compute.slang.

fn mainImage(coord: vec2f) -> vec4f {
    return iChannel0Sample(coord / iResolution.xy);
}
