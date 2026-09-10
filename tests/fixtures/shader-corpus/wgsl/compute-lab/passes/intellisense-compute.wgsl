// WGSL compute IntelliSense fixture.
// WGSL mirror of ../slang/compute-lab/passes/intellisense-compute.slang.
//
// Exercises the compute built-ins side by side: global, workgroup, local,
// and linear local ids. Shared with intellisense_compute.sha.json, exactly
// like the Slang original.

@compute @workgroup_size(4, 4, 1)
fn computeIntellisense(
    @builtin(global_invocation_id) dispatchId: vec3u,
    @builtin(workgroup_id) groupId: vec3u,
    @builtin(local_invocation_id) localId: vec3u,
    @builtin(local_invocation_index) groupIndex: u32
) {
    let size = vec2u(iResolution.xy);
    if (dispatchId.x >= size.x || dispatchId.y >= size.y) {
        return;
    }

    let color = vec3f(
        f32(groupId.x & 15u) / 15.0,
        f32(groupId.y & 15u) / 15.0,
        f32(groupIndex + localId.x + localId.y) / 31.0);
    writeOutput(dispatchId.xy, vec4f(color, 1.0));
}
