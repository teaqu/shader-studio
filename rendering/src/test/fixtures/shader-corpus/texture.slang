import shader_studio;

// Texture input smoke test for Slang/WebGPU.
//
// Config: texture.sha.json binds assets/orientation-texture.svg to iChannel0.
// Expected orientation: red top, green left, blue bottom, yellow right.

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 tex = sampleIChannel0(uv).rgb;

    // Light checker underlay makes failed/black texture loads obvious.
    float2 cells = floor(uv * 16.0);
    float checker = fmod(cells.x + cells.y, 2.0);
    float3 underlay = lerp(float3(0.10, 0.10, 0.12), float3(0.18, 0.18, 0.20), checker);
    float3 col = lerp(underlay, tex, 0.92);

    // Sample fixed points and display them as verification swatches:
    // top, left, bottom, right, center.
    float3 topSample = sampleIChannel0(float2(0.5, 0.94)).rgb;
    float3 leftSample = sampleIChannel0(float2(0.06, 0.5)).rgb;
    float3 bottomSample = sampleIChannel0(float2(0.5, 0.06)).rgb;
    float3 rightSample = sampleIChannel0(float2(0.94, 0.5)).rgb;
    float3 centerSample = sampleIChannel0(float2(0.5, 0.5)).rgb;

    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.84 && uv.y < 0.96) col = topSample;
    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.68 && uv.y < 0.80) col = leftSample;
    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.52 && uv.y < 0.64) col = bottomSample;
    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.36 && uv.y < 0.48) col = rightSample;
    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.20 && uv.y < 0.32) col = centerSample;

    return float4(saturate(col), 1.0);
}
