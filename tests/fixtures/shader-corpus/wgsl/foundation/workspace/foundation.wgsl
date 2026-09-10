// Workspace-foundation Image for WGSL/WebGPU.
// WGSL mirror of ../slang/foundation/workspace/foundation.slang (the
// import/include lines are inlined into common.wgsl — see its header).

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let history = iChannel0Sample(uv).rgb;
    let glow = iChannel1Sample(uv).rgb;
    var color = foundationToneMap(history + glow * 0.75);
    color += foundationPalette(uv.x + iTime * 0.02) * 0.025;

    // Orientation contract: RED is TOP, GREEN is LEFT.
    if (uv.y > 0.985) {
        color = vec3f(14.0, 0.0, 0.0);
    }
    if (uv.x < 0.008) {
        color = vec3f(0.0, 1.0, 0.0);
    }

    return vec4f(color, 1.0);
}
