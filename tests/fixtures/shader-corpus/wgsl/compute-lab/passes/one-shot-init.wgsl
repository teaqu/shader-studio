// One-shot seed writer for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/passes/one-shot-init.slang.

@compute @workgroup_size(1, 1, 1)
fn initializeOnce(@builtin(global_invocation_id) tid: vec3u) {
    if (tid.x != 0u) {
        return;
    }

    // A stable, visible value proves this only changes after Reset/recompile.
    seed[0] = vec4f(0.0, 0.0, 0.0, 1.0);
}
