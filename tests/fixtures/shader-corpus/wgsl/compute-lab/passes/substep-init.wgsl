// Substep initializer for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/passes/substep-init.slang.

@compute @workgroup_size(64, 1, 1)
fn initializeSubsteps(@builtin(global_invocation_id) tid: vec3u) {
    if (tid.x >= 128u) {
        return;
    }

    let angle = 6.2831853 * f32(tid.x) / 128.0;
    let position = 0.48 * vec2f(cos(angle), sin(angle));
    let velocity = 0.3 * vec2f(-position.y, position.x);
    laneA[tid.x] = vec4f(position, velocity);
    laneB[tid.x] = vec4f(position, velocity);
}
