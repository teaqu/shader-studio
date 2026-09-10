// Shared clear/animate kernels for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/passes/multi-entry-kernels.slang.

@compute @workgroup_size(64, 1, 1)
fn clearSamples(@builtin(global_invocation_id) tid: vec3u) {
    if (tid.x < 256u) {
        samples[tid.x] = 0.0;
    }
}

@compute @workgroup_size(64, 1, 1)
fn animateSamples(@builtin(global_invocation_id) tid: vec3u) {
    if (tid.x < 256u) {
        let phase = 0.5 + 0.5 * sin(iTime * 2.0 + f32(tid.x) * 0.09);
        samples[tid.x] = phase;
    }
}
