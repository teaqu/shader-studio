// Three see-through discs with alpha blending. uv.x carries disc id + local x, so mainImage can colour each.
fn mainImage(fragCoord: vec2f) -> vec4f {
    let t = fragCoord.x / iResolution.x * 3.0;
    let id = floor(t);
    let local = vec2f(fract(t), fragCoord.y / iResolution.y) - 0.5;
    let disc = smoothstep(0.5, 0.47, length(local));
    let colour = select(select(vec3f(0.2, 0.4, 1.0), vec3f(0.2, 1.0, 0.2), id < 2.0), vec3f(1.0, 0.2, 0.2), id < 1.0);
    return vec4f(colour, 0.6 * disc);
}
