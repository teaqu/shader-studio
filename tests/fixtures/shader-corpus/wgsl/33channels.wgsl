// 31-channel bind-group stress test for WGSL/WebGPU.
// WGSL mirror of ../slang/33channels.slang.
//
// Samples iChannel0-iChannel30 (all keyboard channels in the config) and
// averages them. A miscompiled bind layout or dropped channel shows up as a
// wrong brightness level; validation errors fail the load outright.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    var col = vec3f(0.0);

    // Sample all 31 channels (well beyond the old 16 limit).
    col += iChannel0Sample(uv).rgb;
    col += iChannel1Sample(uv).rgb;
    col += iChannel2Sample(uv).rgb;
    col += iChannel3Sample(uv).rgb;
    col += iChannel4Sample(uv).rgb;
    col += iChannel5Sample(uv).rgb;
    col += iChannel6Sample(uv).rgb;
    col += iChannel7Sample(uv).rgb;
    col += iChannel8Sample(uv).rgb;
    col += iChannel9Sample(uv).rgb;
    col += iChannel10Sample(uv).rgb;
    col += iChannel11Sample(uv).rgb;
    col += iChannel12Sample(uv).rgb;
    col += iChannel13Sample(uv).rgb;
    col += iChannel14Sample(uv).rgb;
    col += iChannel15Sample(uv).rgb;
    col += iChannel16Sample(uv).rgb;
    col += iChannel17Sample(uv).rgb;
    col += iChannel18Sample(uv).rgb;
    col += iChannel19Sample(uv).rgb;
    col += iChannel20Sample(uv).rgb;
    col += iChannel21Sample(uv).rgb;
    col += iChannel22Sample(uv).rgb;
    col += iChannel23Sample(uv).rgb;
    col += iChannel24Sample(uv).rgb;
    col += iChannel25Sample(uv).rgb;
    col += iChannel26Sample(uv).rgb;
    col += iChannel27Sample(uv).rgb;
    col += iChannel28Sample(uv).rgb;
    col += iChannel29Sample(uv).rgb;
    col += iChannel30Sample(uv).rgb;

    col /= 32.0;
    return vec4f(col, 1.0);
}
