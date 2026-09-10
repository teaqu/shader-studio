// Single-thread workgroup grid writer for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/passes/raw-workgroups.slang.

@compute @workgroup_size(1, 1, 1)
fn drawWorkgroupGrid(@builtin(global_invocation_id) tid: vec3u) {
    let size = vec2u(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y) {
        return;
    }

    let uv = (vec2f(tid.xy) + 0.5) / iResolution.xy;
    let grid = step(0.94, fract(uv.x * 8.0)) + step(0.94, fract(uv.y * 4.0));
    writeOutput(tid.xy, vec4f(uv.x, uv.y, 0.35 + 0.4 * grid, 1.0));
}
