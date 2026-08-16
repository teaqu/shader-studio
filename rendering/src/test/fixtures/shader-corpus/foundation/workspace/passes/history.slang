#language slang 2026
module foundation_workspace_history;
import "../lib/palette.slang";
#include "../include/tone-map.slang"

float foundationBlob(float2 position, float2 center, float radius)
{
    float distanceFromCenter = length(position - center);
    return exp(-distanceFromCenter * distanceFromCenter / (radius * radius));
}

float4 mainImage(float2 fragCoord)
{
    float2 resolution = iResolution.xy;
    float2 uv = fragCoord / resolution;
    float2 downwardDrift = float2(0.0, 1.5) / resolution;
    float3 previous = sampleIChannel0(uv + downwardDrift).rgb * 0.985;

    float2 emitter = resolution * (float2(0.5) + 0.32 * float2(cos(iTime * 0.7), sin(iTime * 1.3)));
    float3 ink = foundationPalette(iTime * 0.11) * foundationBlob(fragCoord, emitter, 12.0);
    if (iMouse.z > 0.0)
        ink += float3(1.0) * foundationBlob(fragCoord, iMouse.xy, 10.0);

    return float4(foundationToneMap(previous + ink), 1.0);
}
