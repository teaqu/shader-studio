// Common declares no script uniforms: the runtime injects each as a global.
fn glow(base: vec3f, amount: f32) -> vec3f {
    return base * amount;
}
