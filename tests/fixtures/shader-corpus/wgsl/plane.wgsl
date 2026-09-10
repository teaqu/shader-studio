// Displaced-plane lighting test for WGSL/WebGPU.
// WGSL mirror of ../slang/plane.slang.
//
// Config (plane.sha.json) sets plane geometry with plane.vert.wgsl. The
// fragment shades with the interpolated world normal (`iNormal`), so the
// wave displacement reads as moving light bands over a grid.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;

    // Simple lighting based on the displaced normal.
    let lightDir = normalize(vec3f(0.5, 1.0, 0.3));
    let normal = normalize(iNormal);
    let diffuse = max(dot(normal, lightDir), 0.0);

    // Grid pattern to show the displacement.
    let grid = abs(fract(uv * 10.0) - vec2f(0.5)) * 2.0;
    var line = 1.0 - min(grid.x, grid.y);
    line = 1.0 - smoothstep(0.0, 0.1, line);

    var col = mix(vec3f(0.1, 0.15, 0.3), vec3f(0.4, 0.6, 1.0), diffuse);
    col = mix(col, vec3f(1.0), line * 0.3);

    return vec4f(col, 1.0);
}
