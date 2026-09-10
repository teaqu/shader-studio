// Resize-feedback test: resizing must preserve accumulated feedback.
// WGSL mirror of ../slang/parity/resize-feedback/resize.slang (with
// history.wgsl). Wait for the green circle, then resize: it must stay at
// 64x64 pixels from the bottom-left and never show red.

fn mainImage(coord: vec2f) -> vec4f {
    let actual = select(0.0, 1.0, iChannel0Sample(coord / iResolution.xy).r >= 0.5);
    let expected = select(0.0, 1.0, length(coord - vec2f(64.0, 64.0)) < 18.0);
    let mismatch = abs(actual - expected);

    // Green circle + black background means preserved correctly. Any red
    // marks either a shifted historical pixel or a missing expected pixel.
    return select(
        select(vec4f(0.0, 0.0, 0.0, 1.0), vec4f(0.0, 0.8, 0.1, 1.0), expected > 0.5),
        vec4f(0.9, 0.0, 0.0, 1.0),
        mismatch > 0.5);
}
