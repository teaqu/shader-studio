// A sphere drawn with "topology": "point-list": one point per mesh vertex. Drag to orbit.
fn mainImage(fragCoord: vec2f) -> vec4f {
    return vec4f(normalize(iNormal) * 0.5 + 0.5, 1.0);
}
