// present.wgsl — compute pass: paint particles to the output texture.
// WGSL mirror of ../slang/present.slang. Selected by entryPoint
// "renderParticles" in particles.sha.json; runs at half resolution.

@compute @workgroup_size(8, 8, 1)
fn renderParticles(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2u(iResolution.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }

    let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
    var col = vec3f(0.02, 0.02, 0.05);

    // Draw each particle as a soft point.
    for (var p = 0u; p < 4u; p += 1u) {
        let particle = particles[p * 1024u + (id.x + id.y * 37u + p * 251u) % 4096u];
        let pos = particle.xy * 0.5 + 0.5;
        let d = length(uv - pos);
        let brightness = smoothstep(0.015, 0.001, d) * 0.3;
        let pcol = 0.5 + 0.5 * cos(6.28 * (f32(p) / 4.0 + vec3f(0.0, 0.33, 0.67)));
        col += pcol * brightness;
    }

    writeOutput(id.xy, vec4f(col, 1.0));
}
