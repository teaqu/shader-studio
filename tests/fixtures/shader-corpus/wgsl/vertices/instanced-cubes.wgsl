// Each instance gets its own hue from iInstanceIndex / iInstanceCount. Drag to orbit.
fn mainImage(fragCoord: vec2f) -> vec4f {
    let t = f32(iInstanceIndex) / f32(iInstanceCount);
    let hue = 0.5 + 0.5 * cos(6.2831853 * (t + vec3f(0.0, 0.33, 0.67)));
    let light = 0.35 + 0.65 * max(dot(normalize(iNormal), normalize(vec3f(0.4, 1.0, 0.3))), 0.0);
    return vec4f(hue * light, 1.0);
}
