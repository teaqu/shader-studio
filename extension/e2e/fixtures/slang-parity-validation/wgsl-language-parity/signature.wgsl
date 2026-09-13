// Scales a colour by gain.
fn shade(color: vec3f, gain: f32) -> vec3f {
    return color * gain;
}

fn mainImage(coord: vec2f) -> vec4f {
    let lit = vec3f(0.5);
    return vec4f(lit, 1.0);
}
