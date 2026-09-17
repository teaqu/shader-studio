@compute @workgroup_size(1, 1, 1)
fn computeMain(@builtin(global_invocation_id) dispatchId: vec3u) {
    writeOutput(dispatchId.xy, vec4f(f32(iDispatch)));
}
