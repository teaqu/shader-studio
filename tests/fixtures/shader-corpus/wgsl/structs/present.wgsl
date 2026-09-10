// present.wgsl — compute pass: visualize struct data as colored bands.
// WGSL mirror of ../slang/structs/present.slang. Selected by entryPoint
// "renderStructs". Each struct type gets a horizontal band; wrong strides
// show up as garbage in the corresponding band.

@compute @workgroup_size(8, 8, 1)
fn renderStructs(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2u(iResolution.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }

    let uv = vec2f(id.xy) / vec2f(size);

    // Background
    var col = vec3f(0.01, 0.01, 0.03);

    // Band layout: each struct type gets a horizontal band
    let band = uv.y * 5.0;
    let bandIndex = u32(floor(band));
    let bandFrac = fract(band);

    // Sample a particle from the corresponding storage buffer
    var sample = vec4f(0.0, 0.0, 0.0, 0.0);
    switch (bandIndex) {
        case 0u: { // Particle band
            let idx = u32(uv.x * 64.0);
            let pos2d = particles[idx].position.xy * 0.5 + 0.5;
            let vel2d = particles[idx].velocity.xy * 0.2 + 0.5;
            sample = vec4f(pos2d.x, pos2d.y, vel2d.x, vel2d.y);
        }
        case 1u: { // ColoredParticle band
            let idx = u32(uv.x * 32.0);
            sample = colored[idx].color;
        }
        case 2u: { // MixedLayout band
            let idx = u32(uv.x * 16.0);
            sample = vec4f(mixed[idx].direction * 0.5 + 0.5, mixed[idx].lifetime);
        }
        case 3u: { // Transform band
            let idx = u32(uv.x * 16.0);
            sample = vec4f(transforms[idx].modelMatrix[0].xyz * 0.5 + 0.5, 1.0);
        }
        case 4u: { // RigidBody band
            let idx = u32(uv.x * 8.0);
            sample = vec4f(rigid[idx].angularVelocity.xyz * 0.3 + 0.5, 1.0);
        }
        default: {
        }
    }

    // Blend sample into the column
    let edge = 1.0 - abs(bandFrac - 0.5) * 2.0;
    col = mix(col, sample.rgb, smoothstep(0.0, 0.02, edge));

    writeOutput(id.xy, vec4f(col, 1.0));
}
