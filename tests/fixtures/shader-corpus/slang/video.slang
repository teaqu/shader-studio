// Video input smoke test for Slang/WebGPU.
//
// Config: video.sha.json binds assets/video-channel-test.mp4 to iChannel0.
// Expected behavior: moving color bars fill the frame; the swatches down the
// left side update with the video; a black/static frame means video upload or
// per-frame texture refresh is not working.

float box(float2 uv, float2 lo, float2 hi)
{
    float2 insideLo = step(lo, uv);
    float2 insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 video = inputs.iChannel0.Sample(uv).rgb;

    // Animated underlay makes a missing/black video channel obvious.
    float pulse = 0.5 + 0.5 * sin(iTime * 4.0 + uv.x * 18.0);
    float3 underlay = lerp(float3(0.04, 0.04, 0.07), float3(0.16, 0.08, 0.20), pulse);
    float3 col = lerp(underlay, video, 0.94);

    // Fixed sample swatches show orientation and prove the shader is sampling
    // the video channel rather than only displaying a copied full-frame image.
    float3 topSample = inputs.iChannel0.Sample(float2(0.5, 0.92)).rgb;
    float3 leftSample = inputs.iChannel0.Sample(float2(0.08, 0.5)).rgb;
    float3 bottomSample = inputs.iChannel0.Sample(float2(0.5, 0.08)).rgb;
    float3 rightSample = inputs.iChannel0.Sample(float2(0.92, 0.5)).rgb;

    if (box(uv, float2(0.06, 0.78), float2(0.19, 0.91)) > 0.0) col = topSample;
    if (box(uv, float2(0.06, 0.60), float2(0.19, 0.73)) > 0.0) col = leftSample;
    if (box(uv, float2(0.06, 0.42), float2(0.19, 0.55)) > 0.0) col = bottomSample;
    if (box(uv, float2(0.06, 0.24), float2(0.19, 0.37)) > 0.0) col = rightSample;

    // Thin time marker should glide across the frame even when video decode is
    // slow, making it easy to distinguish shader time from video playback.
    float marker = 1.0 - smoothstep(0.0, 0.012, abs(uv.x - frac(iTime * 0.18)));
    col = lerp(col, float3(1.0, 1.0, 1.0), marker * 0.75);

    return float4(saturate(col), 1.0);
}
