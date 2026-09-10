fn commonTint(coord: vec2f) -> vec3f {
    let shade = 0.375;
    return vec3f(shade, coord.x * 0.0, 1.0 - shade);
}
