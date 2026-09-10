// Fixed-dispatch coverage kernel for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/passes/workgroup-coverage.slang.

@compute @workgroup_size(12, 8, 1)
fn coverageKernel(@builtin(global_invocation_id) tid: vec3u) {
    let size = vec2u(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y) {
        return;
    }

    let uv = (vec2f(tid.xy) + 0.5) / iResolution.xy;
    let checker = fract(floor(uv.x * 20.0) + floor(uv.y * 12.0)) * 2.0;
    writeOutput(tid.xy, vec4f(0.1 + 0.75 * uv.x, 0.25 + 0.65 * uv.y, 0.35 + 0.4 * checker, 1.0));
}
