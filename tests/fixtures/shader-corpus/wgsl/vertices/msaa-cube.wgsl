// A cube with four-sample MSAA. Its silhouette should have partially covered edge pixels.
fn mainImage(fragCoord: vec2f) -> vec4f {
    let light = normalize(vec3f(0.4, 1.0, 0.3));
    let shade = 0.25 + 0.75 * max(dot(normalize(iNormal), light), 0.0);
    return vec4f(vec3f(0.2, 0.65, 1.0) * shade, 1.0);
}
