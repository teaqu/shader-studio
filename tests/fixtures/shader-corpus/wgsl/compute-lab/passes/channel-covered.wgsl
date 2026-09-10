// Channel-cover transform for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/passes/channel-covered.slang.
// Samples the previous compute output with an explicit level (required in
// compute stages) and swaps/boosts channels.

@compute @workgroup_size(8, 8, 1)
fn transformCoveredChannel(@builtin(global_invocation_id) tid: vec3u) {
    let size = vec2u(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y) {
        return;
    }

    let uv = (vec2f(tid.xy) + 0.5) / iResolution.xy;
    let source = iChannel0SampleLevel(uv, 0.0).rgb;
    writeOutput(tid.xy, vec4f(source.bgr * vec3f(1.0, 0.8, 1.2), 1.0));
}
