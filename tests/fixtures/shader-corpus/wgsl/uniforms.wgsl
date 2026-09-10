// Custom + remaining ShaderToy uniform parity test for WGSL/WebGPU.
// WGSL mirror of ../uniforms.slang.
//
// Top row, left to right: float, vec2, vec3, vec4, bool. All panels should
// animate; the bool panel alternates green/blue once per second.
// Middle strips: iCameraPos and iCameraDir. Bottom row: iDate, then
// iCh metadata checks for texture, audio, and keyboard, plus a
// Sample/SampleLevel agreement probe. Every status tile should be green.
//
// WGSL adaptations vs Slang (see wgsl/README.md):
// - Script uniforms (uFloat…uBool) arrive as injected globals: do NOT declare.
// - No iChN wrappers: sampling is iChannelNSample(), metadata is
//   iChannelNSize()/iChannelNTime()/iChannelNLoaded().
// - No iChannelResolution array: the unused-slot tile instead checks that
//   Sample and SampleLevel(…, 0.0) agree on the texture channel.
// - No ternary operator: `select` is used instead.

fn box(uv: vec2f, lo: vec2f, hi: vec2f) -> f32 {
    let insideLo = step(lo, uv);
    let insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

fn resolutionMatches(actual: vec3f, expected: vec3f) -> f32 {
    return select(0.0, 1.0, all(abs(actual - expected) < vec3f(0.5)));
}

fn statusColor(ok: f32) -> vec3f {
    return mix(vec3f(0.85, 0.03, 0.03), vec3f(0.03, 0.85, 0.12), ok);
}

// Size() returns vec2u; lift it to the vec3f shape the checks compare.
fn channelSizeVec3(size: vec2u) -> vec3f {
    return vec3f(vec2f(size), 1.0);
}

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    var col = vec3f(0.025, 0.03, 0.045);

    // Five custom-uniform panels.
    let floatPanel = box(uv, vec2f(0.03, 0.54), vec2f(0.18, 0.94));
    let floatFill = box(uv, vec2f(0.03, 0.54), vec2f(0.18, 0.54 + 0.40 * uFloat));
    col = mix(col, vec3f(0.10, 0.10, 0.12), floatPanel);
    col = mix(col, vec3f(uFloat), floatFill);

    let vec2Panel = box(uv, vec2f(0.23, 0.54), vec2f(0.38, 0.94));
    col = mix(col, vec3f(uVec2, 0.15), vec2Panel);

    let vec3Panel = box(uv, vec2f(0.43, 0.54), vec2f(0.58, 0.94));
    col = mix(col, uVec3, vec3Panel);

    let vec4Panel = box(uv, vec2f(0.63, 0.54), vec2f(0.78, 0.94));
    col = mix(col, uVec4.rgb, vec4Panel);
    let alphaBand = box(uv, vec2f(0.63, 0.54), vec2f(0.78, 0.54 + 0.40 * uVec4.a));
    col = mix(col, vec3f(1.0), alphaBand * 0.35);

    let boolPanel = box(uv, vec2f(0.83, 0.54), vec2f(0.97, 0.94));
    let boolColor = select(vec3f(0.05, 0.2, 0.95), vec3f(0.05, 0.9, 0.15), uBool);
    col = mix(col, boolColor, boolPanel);

    // Camera position is compressed into RGB around mid-grey so movement in
    // either direction remains visible. Camera direction maps [-1, 1] to
    // [0, 1]; its default (0, 0, -1) is yellow. The small direction badge is
    // green only while iCameraDir remains normalized.
    let cameraPosColor = vec3f(0.5) + vec3f(0.45) * iCameraPos / (vec3f(1.0) + abs(iCameraPos));
    let cameraDirColor = vec3f(0.5) + vec3f(0.5) * iCameraDir;
    col = mix(col, cameraPosColor, box(uv, vec2f(0.03, 0.455), vec2f(0.48, 0.515)));
    col = mix(col, cameraDirColor, box(uv, vec2f(0.52, 0.455), vec2f(0.97, 0.515)));
    let cameraDirOk = select(0.0, 1.0, abs(length(iCameraDir) - 1.0) < 0.01);
    col = mix(col, statusColor(cameraDirOk), box(uv, vec2f(0.93, 0.465), vec2f(0.96, 0.505)));

    // Date is considered valid when its calendar fields and seconds-of-day
    // are in range. The moving white band makes live iDate updates visible.
    let dateOk = select(0.0, 1.0, iDate.x >= 2024.0 && iDate.y >= 0.0 && iDate.y <= 11.0 &&
        iDate.z >= 1.0 && iDate.z <= 31.0 && iDate.w >= 0.0 && iDate.w < 86400.0);
    let datePanel = box(uv, vec2f(0.03, 0.10), vec2f(0.18, 0.42));
    col = mix(col, statusColor(dateOk), datePanel);
    let secondsBand = box(
        uv,
        vec2f(0.03, 0.10),
        vec2f(0.03 + 0.15 * fract(iDate.w / 60.0), 0.14)
    );
    col = mix(col, vec3f(1.0), secondsBand);

    let checks = vec4f(
        resolutionMatches(channelSizeVec3(iChannel0Size()), vec3f(256.0, 256.0, 1.0)) * select(0.0, 1.0, iChannel0Loaded()),
        resolutionMatches(channelSizeVec3(iChannel1Size()), vec3f(512.0, 2.0, 1.0)) * select(0.0, 1.0, iChannel1Loaded()),
        resolutionMatches(channelSizeVec3(iChannel2Size()), vec3f(256.0, 3.0, 1.0)) * select(0.0, 1.0, iChannel2Loaded()),
        select(0.0, 1.0, all(abs(iChannel0SampleLevel(vec2f(0.25, 0.75), 0.0).rgb - iChannel0Sample(vec2f(0.25, 0.75)).rgb) < vec3f(0.02)))
    );
    col = mix(col, statusColor(checks.x), box(uv, vec2f(0.23, 0.10), vec2f(0.38, 0.42)));
    col = mix(col, statusColor(checks.y), box(uv, vec2f(0.43, 0.10), vec2f(0.58, 0.42)));
    col = mix(col, statusColor(checks.z), box(uv, vec2f(0.63, 0.10), vec2f(0.78, 0.42)));
    col = mix(col, statusColor(checks.w), box(uv, vec2f(0.83, 0.10), vec2f(0.97, 0.42)));

    // Exercise the sampler path and channel time as live values rather than
    // merely compiling their accessors. The texture-center swatch sits in the
    // texture tile; the audio-time bar grows across the bottom of the audio
    // tile.
    let textureProbe = iChannel0Sample(vec2f(0.25, 0.75)).rgb;
    col = mix(col, textureProbe, box(uv, vec2f(0.25, 0.34), vec2f(0.36, 0.40)));
    let audioTimeBand = box(
        uv,
        vec2f(0.43, 0.10),
        vec2f(0.43 + 0.15 * fract(iChannel1Time() / 10.0), 0.14)
    );
    col = mix(col, vec3f(1.0), audioTimeBand);

    return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
