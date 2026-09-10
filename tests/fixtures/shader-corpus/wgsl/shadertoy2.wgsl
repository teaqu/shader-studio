// Sphere-geometry + compute smoke test for WGSL/WebGPU.
// WGSL mirror of ../slang/shadertoy2.slang.
//
// Config renders on sphere geometry with an (empty) CompA compute pass: the
// point is that compute + geometry stages coexist. Expect the cosine palette
// wrapped on a sphere; a flat fullscreen gradient means geometry was ignored.

fn mainImage(coord: vec2f) -> vec4f {
    // Normalized pixel coordinates (from 0 to 1).
    let uv = coord / iResolution.xy;

    // Time varying pixel color.
    let col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3f(0.0, 2.0, 4.0));

    // Output to screen.
    return vec4f(col, 1.0);
}
