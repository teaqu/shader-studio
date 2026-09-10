// CatBody composite for the WGSL model test.
// WGSL mirror of ../glsl/cat-glsl.glsl (the Image half of cat.sha.json):
// lit body gradient plus the CatHead buffer feed.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let light = 0.3 + 0.7 * max(dot(normalize(iNormal), normalize(vec3f(0.4, 0.8, 0.3))), 0.0);
    let body = mix(vec3f(0.03, 0.1, 0.28), vec3f(0.06, 0.7, 1.0), uv.y) * light;
    return vec4f(body + iChannel0Sample(uv).rgb * 0.35, 1.0);
}
