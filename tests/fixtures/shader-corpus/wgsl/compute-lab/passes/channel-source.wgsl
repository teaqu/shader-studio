// Fixed-size compute texture source for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/passes/channel-source.slang.

@compute @workgroup_size(8, 8, 1)
fn generateChannel(@builtin(global_invocation_id) tid: vec3u) {
    let size = vec2u(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y) {
        return;
    }

    let uv = (vec2f(tid.xy) + 0.5) / iResolution.xy;
    let waves = 0.5 + 0.5 * sin(uv.x * 18.0 + iTime * 2.0);
    writeOutput(tid.xy, vec4f(uv.x, waves, uv.y, 1.0));
}
