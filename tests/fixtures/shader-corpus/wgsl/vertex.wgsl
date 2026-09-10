// Custom WGSL vertex shader smoke test. WGSL mirror of ../vertex.slang.
//
// The configured vertex hook replaces Shader Studio's fullscreen triangle
// with a smaller centered triangle, leaving the cleared background visible.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;

    var color = vec3f(uv, 0.35 + 0.25 * sin(iTime));
    let gridX = step(0.92, fract(uv.x * 10.0));
    let gridY = step(0.92, fract(uv.y * 10.0));
    color = mix(color, vec3f(1.0), max(gridX, gridY));

    return vec4f(color, 1.0);
}
