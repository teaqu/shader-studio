// Initialize the vertex transform storage for the vertex-hook test.
// WGSL mirror of ../slang/vertex_init.slang. Runs once (dispatchOnce in
// vertex.sha.json) and writes the scale/offset the hook applies.

@compute @workgroup_size(1, 1, 1)
fn initializeVertexTransform(@builtin(global_invocation_id) tid: vec3u) {
    if (tid.x == 0u) {
        vertexTransform[0] = vec4f(0.62, 0.58, 0.16, -0.12);
    }
}
