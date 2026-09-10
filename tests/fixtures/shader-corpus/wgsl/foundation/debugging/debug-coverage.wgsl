// Debug-coverage Image for WGSL/WebGPU.
// WGSL mirror of ../slang/foundation/debugging/debug-coverage.slang (the
// debugpalette import is inlined into common.wgsl — see its header).
// This fixture is the manual acceptance target for root, buffer, common,
// direct-import, and transitive-import debugging.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let history = iChannel0Sample(uv).rgb;

    let phase = uv.x * 1.75 + uv.y * 0.5 + iTime * 0.08;
    let paletteColor = debugPalette(phase);
    let scanline = 0.75 + 0.25 * sin(uv.y * iResolution.y * 0.16 + iTime * 3.0);

    let mixedColor = mix(history, paletteColor, 0.28) * scanline;
    let vignette = debugVignette(uv);
    let finalColor = debugToneMap(mixedColor * vignette);

    return vec4f(finalColor, 1.0);
}
