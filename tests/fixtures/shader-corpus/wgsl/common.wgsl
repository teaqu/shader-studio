// Shared helpers — configured as the "common" pass, prepended verbatim to
// every renderable pass (BufferA, BufferB, Image). WGSL mirror of
// ../common.slang.

fn palette(t: f32) -> vec3f {
    return vec3f(1.5) + vec3f(0.5) * cos(6.28318 * (vec3f(t) + vec3f(0.0, 0.33, 0.67)));
}

// Gaussian-ish blob centred at c (pixels), radius r (pixels).
fn blob(p: vec2f, c: vec2f, r: f32) -> f32 {
    let d = p - c;
    return exp(-dot(d, d) / (r * r));
}
