// init.wgsl — one-shot compute pass: initialize particle positions.
// WGSL mirror of ../slang/init.slang. Selected by entryPoint
// "initParticles" in particles.sha.json; covers the `particles` buffer once.

@compute @workgroup_size(64, 1, 1)
fn initParticles(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= 4096u) { return; }

    let t = f32(id.x) / 4096.0;
    particles[id.x] = vec4f(
        cos(t * 6.28318 * 3.0),
        sin(t * 6.28318 * 5.0),
        cos(t * 6.28318 * 2.0),
        1.0
    );
}
