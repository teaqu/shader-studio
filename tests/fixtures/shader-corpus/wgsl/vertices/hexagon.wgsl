// Clip-space hexagon: six vertices joined as a triangle strip, fixed on screen.
fn mainImage(fragCoord: vec2f) -> vec4f {
    let uv = fragCoord / iResolution.xy;
    return vec4f(0.5 + 0.5 * cos(iTime + uv.xyx + vec3f(0.0, 2.0, 4.0)), 1.0);
}
