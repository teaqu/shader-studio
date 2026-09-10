// One native entry point per dispatch mode for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/passes/dispatch-modes-kernels.slang.
// Open dispatch-modes.wgsl to view all four outputs at once, then adjust a
// pass's dispatch config in the UI. Selected via entryPoint.

@compute @workgroup_size(8, 8, 1)
fn texelMode(@builtin(global_invocation_id) tid: vec3u) {
    let size = vec2u(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y) { return; }
    let uv = (vec2f(tid.xy) + 0.5) / vec2f(size);
    writeOutput(tid.xy, vec4f(uv.x, uv.y, 0.2, 1.0));
}

@compute @workgroup_size(64, 1, 1)
fn countMode(@builtin(global_invocation_id) tid: vec3u) {
    if (tid.x >= 256u) { return; }
    let band = select(0.25, 1.0, fract(f32(tid.x) / 32.0) < 0.5);
    for (var y = 0u; y < u32(iResolution.y); y += 1u) {
        writeOutput(vec2u(tid.x, y), vec4f(0.15, band, 0.7 * band, 1.0));
    }
}

@compute @workgroup_size(16, 8, 1)
fn workgroupsMode(@builtin(global_invocation_id) tid: vec3u) {
    let size = vec2u(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y) { return; }
    let checker = f32(((tid.x / 16u) + (tid.y / 8u)) % 2u);
    writeOutput(tid.xy, vec4f(0.85 * checker, 0.25, 1.0 - 0.6 * checker, 1.0));
}

@compute @workgroup_size(16, 1, 1)
fn coverStorageMode(@builtin(global_invocation_id) tid: vec3u) {
    if (tid.x >= 128u) { return; }
    coverageItems[tid.x] = f32(tid.x) / 127.0;
    let x = tid.x * 2u;
    let value = coverageItems[tid.x];
    for (var y = 0u; y < u32(iResolution.y); y += 1u) {
        let shade = 0.3 + 0.7 * value;
        writeOutput(vec2u(x, y), vec4f(shade, 0.45 * shade, 0.08, 1.0));
        writeOutput(vec2u(x + 1u, y), vec4f(shade, 0.45 * shade, 0.08, 1.0));
    }
}
