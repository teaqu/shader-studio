// Video + audio input parity test for Slang/WebGPU.
//
// Config: video_audio.sha.json binds a video to iChannel0 and the seamless
// PCM test tone to iChannel1. This mirrors video_audio_glsl.glsl so the two
// rendering backends should produce the same image and audio visualization.

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;

    float3 videoColor = inputs.iChannel0.Sample(uv).rgb;
    float spectrum = inputs.iChannel1.Sample(float2(uv.x, 0.25)).r;
    float waveform = inputs.iChannel1.Sample(float2(uv.x, 0.75)).r;

    float bar = smoothstep(uv.y - 0.015, uv.y + 0.015, spectrum * 0.85);
    float waveLine = 1.0 - smoothstep(
        0.0,
        0.015,
        abs(uv.y - (0.5 + (waveform - 0.5) * 0.45))
    );

    float3 color = videoColor * 0.45;
    color += float3(0.05, 0.85, 1.0) * bar;
    color += float3(1.0, 0.95, 0.2) * waveLine;

    if (uv.x < 0.03)
    {
        color = float3(spectrum, waveform, 0.2);
    }

    return float4(color, 1.0);
}
