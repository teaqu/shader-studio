// Bare-minimum WGSL sanity shader (no config — uses defaults).
// WGSL mirror of ../glsl/shadertoy.glsl.

fn mainImage(coord: vec2f) -> vec4f {
    // Normalized pixel coordinates (from 0 to 1).
    let uv = coord / iResolution.xy;

    // Time varying pixel color.
    let col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3f(0.0, 2.0, 4.0));

    // Output to screen.
    return vec4f(col, 1.0);
}
