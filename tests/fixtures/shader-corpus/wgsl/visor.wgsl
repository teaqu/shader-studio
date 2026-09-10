// Animated visor scanline pattern (BufferA of the two-meshes WGSL test).
// WGSL mirror of ../slang/visor.slang. Values exceed 1.0 — HDR check.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let scanline = 3.75 + 0.25 * sin(uv.y * 220.0 + iTime * 8.0);
    return vec4f(vec3f(1.0, 0.48, 0.08) * scanline, 1.0);
}
