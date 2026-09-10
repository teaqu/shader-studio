// Empty compute companion for the shadertoy2 WGSL test.
// WGSL mirror of ../slang/shadertoy2.computea.slang. Runs as CompA in
// shadertoy2.sha.json and intentionally writes nothing.

@compute @workgroup_size(8, 8, 1)
fn compute(@builtin(global_invocation_id) id: vec3u) {
}
