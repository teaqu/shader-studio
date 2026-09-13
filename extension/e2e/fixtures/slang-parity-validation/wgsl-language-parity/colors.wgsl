fn mainImage(coord: vec2f) -> vec4f {
    let tint = vec3f(1.0, 0.0, 0.0);
    let glow = vec3<f32>(0.0, 0.5, 1.0);
    return vec4f(tint + glow, 1.0);
}
