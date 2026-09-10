// Storage gradient writer for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/passes/count-gradient.slang.
// A `{ "count": 256 }` dispatch writes one animated value per element.

@compute @workgroup_size(64, 1, 1)
fn writeGradient(@builtin(global_invocation_id) tid: vec3u) {
    if (tid.x >= 256u) {
        return;
    }

    let phase = 0.5 + 0.5 * sin(iTime + f32(tid.x) * 0.11);
    samples[tid.x] = phase;
}
