// Native compute system values for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/passes/system-values.slang.
//
// Every parameter is a native system value. The colours make their
// relationship visible: red/green are global dispatch coordinates, blue is
// the linear local-workgroup index, and the alternating tint is workgroup ID.

@compute @workgroup_size(8, 8, 1)
fn systemValues(
    @builtin(global_invocation_id) dispatchId: vec3u,
    @builtin(workgroup_id) groupId: vec3u,
    @builtin(local_invocation_id) localId: vec3u,
    @builtin(local_invocation_index) localIndex: u32
) {
    let size = vec2u(iResolution.xy);
    if (dispatchId.x >= size.x || dispatchId.y >= size.y) {
        return;
    }

    let uv = (vec2f(dispatchId.xy) + 0.5) / vec2f(size);
    let local = f32(localIndex) / 63.0;
    let checker = f32((groupId.x + groupId.y) % 2u);
    var color = vec3f(uv, local);
    color = mix(color, color.yzx, 0.25 * checker);
    color += 0.04 * vec3f(vec2f(localId.xy), 0.0);
    writeOutput(dispatchId.xy, vec4f(color, 1.0));
}
