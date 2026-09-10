// Solver substep for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/passes/substep.slang. iDispatch
// selects the read lane so consecutive substeps ping-pong between laneA
// and laneB.

@compute @workgroup_size(64, 1, 1)
fn simulateSubstep(@builtin(global_invocation_id) tid: vec3u) {
    if (tid.x >= 128u) {
        return;
    }

    let readA = (iDispatch % 2) == 0;
    let state = select(laneB[tid.x], laneA[tid.x], readA);
    var position = state.xy;
    var velocity = state.zw;
    let dt = min(iTimeDelta, 1.0 / 30.0) / 6.0;
    velocity += -0.8 * position * dt;
    position += velocity * dt;
    if (readA) {
        laneB[tid.x] = vec4f(position, velocity);
    } else {
        laneA[tid.x] = vec4f(position, velocity);
    }
}
