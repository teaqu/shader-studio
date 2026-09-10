// sim.wgsl — per-frame compute: integrate gravity.
// WGSL mirror of ../slang/gravity/sim.slang. Selected by entryPoint
// "simulateBodies"; runs 4 substeps per frame (dispatchCount in config).

@compute @workgroup_size(64, 1, 1)
fn simulateBodies(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= 256u) { return; }

    var current = bodies[id.x];

    // N-body gravity (simplified — only from the first 32 bodies).
    var force = vec3f(0.0, 0.0, 0.0);
    for (var j = 0u; j < 32u; j += 1u) {
        if (j == id.x) { continue; }
        force += gravityForce(current, bodies[j]);
    }

    current.velocity.xyz += force * 0.0001;
    current.position.xyz += current.velocity.xyz * 0.0001;

    bodies[id.x] = current;
}
