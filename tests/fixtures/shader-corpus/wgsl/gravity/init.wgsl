// init.wgsl — one-shot: initialize bodies in a ring.
// WGSL mirror of ../slang/gravity/init.slang. Selected by entryPoint
// "initBodies"; covers the `bodies` buffer once.

@compute @workgroup_size(64, 1, 1)
fn initBodies(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= 256u) { return; }

    let angle = f32(id.x) / 256.0 * 6.28318;
    let radius = 0.4;
    let speed = 0.3 / sqrt(radius);

    bodies[id.x].position = vec4f(cos(angle) * radius, sin(angle) * radius, 0.0, 1.0);
    bodies[id.x].velocity = vec4f(-sin(angle) * speed, cos(angle) * speed, 0.0, 0.0);
}
