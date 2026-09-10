@compute @workgroup_size(8, 8, 1)
fn update(@builtin(global_invocation_id) id: vec3u) {
    let wave: f32 = 0.625;
    writeOutput(id.xy, vec4f(wave, 0.0, 0.0, 1.0));
}
