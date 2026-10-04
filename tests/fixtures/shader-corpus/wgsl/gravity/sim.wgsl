// sim.wgsl — per-frame compute: integrate gravity.
// WGSL mirror of ../slang/gravity/sim.slang. Selected by entryPoint
@compute @workgroup_size(64, 1, 1)
fn simulateBodies(@builtin(global_invocation_id) id: vec3u) {
    // One invocation serializes this deliberately small corpus fixture. It
    // snapshots the force inputs so each of the four configured substeps has
    // deterministic simultaneous-update semantics without a storage race.
    if (id.x != 0u) { return; }

    var forceSources: array<Body, 32>;
    for (var source = 0u; source < 32u; source += 1u) {
        forceSources[source] = bodies[source];
    }

    for (var body = 0u; body < 256u; body += 1u) {
        var current = bodies[body];
        if (body < 32u) {
            current = forceSources[body];
        }

        // N-body gravity (simplified — only from the first 32 bodies).
        var force = vec3f(0.0, 0.0, 0.0);
        for (var j = 0u; j < 32u; j += 1u) {
            if (j == body) { continue; }
            force += gravityForce(current, forceSources[j]);
        }

        // Whole-vector stores: a swizzle store needs the optional
        // `swizzle_assignment` language feature, which VS Code's Chromium lacks.
        current.velocity = vec4f(current.velocity.xyz + force * 0.0001, current.velocity.w);
        current.position = vec4f(current.position.xyz + current.velocity.xyz * 0.0001, current.position.w);

        bodies[body] = current;
    }
}
