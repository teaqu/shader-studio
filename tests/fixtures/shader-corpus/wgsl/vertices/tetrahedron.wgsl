// World-space tetrahedron: 12 vertices, lit by iNormal, back faces culled. Drag to orbit.
fn mainImage(fragCoord: vec2f) -> vec4f {
    let light = max(dot(iNormal, normalize(vec3f(0.5, 1.0, 0.3))), 0.0);
    return vec4f(vec3f(0.15, 0.2, 0.35) + vec3f(0.9, 0.7, 0.4) * light, 1.0);
}
