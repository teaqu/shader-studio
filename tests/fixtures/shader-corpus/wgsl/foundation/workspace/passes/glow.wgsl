// Workspace-foundation glow buffer for WGSL/WebGPU.
// WGSL mirror of ../slang/foundation/workspace/passes/glow.slang.
// Runs at half resolution (see foundation.sha.json).

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    var glow = foundationBlurHistory(uv);
    glow *= 2.82 + 0.18 * foundationPalette(iTime * 0.05);
    return vec4f(glow, 1.0);
}
