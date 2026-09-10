// Video input smoke test for WGSL/WebGPU. WGSL mirror of ../video.slang.
//
// Config: video.sha.json binds ../assets/video-channel-test.mp4 to iChannel0.
// Expected behavior: moving color bars fill the frame; the swatches down the
// left side update with the video; a black/static frame means video upload or
// per-frame texture refresh is not working.

fn box(uv: vec2f, lo: vec2f, hi: vec2f) -> f32 {
    let insideLo = step(lo, uv);
    let insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let video = iChannel0Sample(uv).rgb;

    // Animated underlay makes a missing/black video channel obvious.
    let pulse = 0.5 + 0.5 * sin(iTime * 4.0 + uv.x * 18.0);
    let underlay = mix(vec3f(0.04, 0.04, 0.07), vec3f(0.16, 0.08, 0.20), pulse);
    var col = mix(underlay, video, 0.94);

    // Fixed sample swatches show orientation and prove the shader is sampling
    // the video channel rather than only displaying a copied full-frame image.
    let topSample = iChannel0Sample(vec2f(0.5, 0.92)).rgb;
    let leftSample = iChannel0Sample(vec2f(0.08, 0.5)).rgb;
    let bottomSample = iChannel0Sample(vec2f(0.5, 0.08)).rgb;
    let rightSample = iChannel0Sample(vec2f(0.92, 0.5)).rgb;

    if (box(uv, vec2f(0.06, 0.78), vec2f(0.19, 0.91)) > 0.0) { col = topSample; }
    if (box(uv, vec2f(0.06, 0.60), vec2f(0.19, 0.73)) > 0.0) { col = leftSample; }
    if (box(uv, vec2f(0.06, 0.42), vec2f(0.19, 0.55)) > 0.0) { col = bottomSample; }
    if (box(uv, vec2f(0.06, 0.24), vec2f(0.19, 0.37)) > 0.0) { col = rightSample; }

    // Thin time marker should glide across the frame even when video decode is
    // slow, making it easy to distinguish shader time from video playback.
    let marker = 1.0 - smoothstep(0.0, 0.012, abs(uv.x - fract(iTime * 0.18)));
    col = mix(col, vec3f(1.0), marker * 0.75);

    return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
