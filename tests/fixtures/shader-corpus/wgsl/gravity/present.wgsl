// present.wgsl — compute pass: render bodies to the output texture.
// WGSL mirror of ../slang/gravity/present.slang. Selected by entryPoint
// "renderBodies"; runs at half resolution with one output layer.

@compute @workgroup_size(8, 8, 1)
fn renderBodies(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2u(iResolution.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }

    let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
    var col = vec3f(0.01, 0.01, 0.03);

    for (var i = 0u; i < 256u; i += 1u) {
        let pos = bodies[i].position.xy * 0.5 + 0.5;
        let d = length(uv - pos);
        let brightness = smoothstep(0.012, 0.001, d) * (bodies[i].position.w * 0.1);
        let bcol = 0.5 + 0.5 * cos(6.28 * (f32(i) / 256.0 + vec3f(0.0, 0.33, 0.67)));
        col += bcol * brightness;
    }

    writeOutput(id.xy, vec4f(col, 1.0));
}
