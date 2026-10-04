// Clip-space points: 1024 single-pixel points on a swirling 32x32 grid.
fn mainImage(fragCoord: vec2f) -> vec4f {
    return vec4f(fragCoord / iResolution.xy, 1.0, 1.0);
}
