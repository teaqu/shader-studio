// A sphere drawn with "topology": "line-list": each unique edge once, as a wireframe. Drag to orbit.
fn mainImage(fragCoord: vec2f) -> vec4f {
    return vec4f(normalize(iNormal) * 0.5 + 0.5, 1.0);
}
