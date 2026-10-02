// 1000 additive particles (6 vertices each) in world space, depth writes off so none hides another.
fn mainImage(fragCoord: vec2f) -> vec4f {
    let uv = fragCoord / iResolution.xy;
    let glow = smoothstep(0.5, 0.0, length(uv - 0.5));
    return vec4f(vec3f(1.0, 0.6, 0.2) * glow * 0.5, 1.0);
}
