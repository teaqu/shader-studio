// init.wgsl — one-shot: initialize all struct types with test data.
// WGSL mirror of ../slang/structs/init.slang. Selected by entryPoint
// "initStructs"; covers the `particles` buffer (largest count) once.

@compute @workgroup_size(64, 1, 1)
fn initStructs(@builtin(global_invocation_id) id: vec3u) {
    // Particle (32 bytes): position + velocity
    if (id.x < 64u) {
        let t = f32(id.x) / 64.0;
        particles[id.x].position = vec4f(cos(t * 6.28), sin(t * 6.28), 0.0, 1.0);
        particles[id.x].velocity = vec4f(-sin(t * 6.28), cos(t * 6.28), 0.0, 0.0);
    }

    // ColoredParticle (48 bytes): position + velocity + color
    if (id.x < 32u) {
        colored[id.x].position = vec4f(0.0, 0.0, 0.0, 1.0);
        colored[id.x].velocity = vec4f(0.0, 0.0, 0.0, 0.0);
        let hue = f32(id.x) / 32.0;
        let rgb = 0.5 + 0.5 * cos(6.28 * (hue + vec3f(0.0, 0.33, 0.67)));
        colored[id.x].color = vec4f(rgb, 1.0);
    }

    // MixedLayout (48 bytes): direction + lifetime + extra
    if (id.x < 16u) {
        mixed[id.x].direction = normalize(vec3f(
            cos(f32(id.x) * 0.5),
            sin(f32(id.x) * 0.7),
            0.5
        ));
        mixed[id.x].lifetime = f32(id.x) / 16.0;
        mixed[id.x].extra = vec4f(1.0, 0.0, 0.0, 1.0);
    }

    // Transform (64 bytes): mat4x4f
    if (id.x < 16u) {
        let angle = f32(id.x) / 16.0 * 6.28;
        let c = cos(angle);
        let s = sin(angle);
        transforms[id.x].modelMatrix = mat4x4f(
            vec4f( c,  s, 0.0, 0.0),
            vec4f(-s,  c, 0.0, 0.0),
            vec4f(0.0, 0.0, 1.0, 0.0),
            vec4f(0.0, 0.0, 0.0, 1.0)
        );
    }

    // RigidBody (80 bytes): mat4x4f + vec4f
    if (id.x < 8u) {
        rigid[id.x].transform = transforms[id.x % 16u].modelMatrix;
        rigid[id.x].angularVelocity = vec4f(1.0, 0.5, 0.25, 0.0);
    }
}
