// Video + audio input parity test for WGSL/WebGPU.
// WGSL mirror of ../video_audio.slang.
//
// Config: video_audio.sha.json binds a video to iChannel0 and the seamless
// PCM test tone to iChannel1.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;

    let videoColor = iChannel0Sample(uv).rgb;
    let spectrum = iChannel1Sample(vec2f(uv.x, 0.25)).r;
    let waveform = iChannel1Sample(vec2f(uv.x, 0.75)).r;

    let bar = smoothstep(uv.y - 0.015, uv.y + 0.015, spectrum * 0.85);
    let waveLine = 1.0 - smoothstep(
        0.0,
        0.015,
        abs(uv.y - (0.5 + (waveform - 0.5) * 0.45))
    );

    var color = videoColor * 0.45;
    color += vec3f(0.05, 0.85, 1.0) * bar;
    color += vec3f(1.0, 0.95, 0.2) * waveLine;

    if (uv.x < 0.03) {
        color = vec3f(spectrum, waveform, 0.2);
    }

    return vec4f(color, 1.0);
}
