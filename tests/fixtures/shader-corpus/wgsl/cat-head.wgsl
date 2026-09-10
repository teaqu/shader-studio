// CatHead scanline pattern for the WGSL model test.
// WGSL mirror of ../glsl/cat-head.glsl. Doubles as BufferA (under the CatHead
// mesh in cat.sha.json) and as a standalone Image (cat-head.sha.json).

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let scanline = 0.75 + 0.25 * sin(uv.y * 220.0 + iTime * 8.0);
    return vec4f(vec3f(1.0, 0.48, 0.08) * scanline, 1.0);
}
