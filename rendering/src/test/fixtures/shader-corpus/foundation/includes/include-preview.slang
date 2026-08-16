#language slang 2026
module foundation_include_preview;
#include "tone-map.slang"

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 hdr = float3(uv.x * 2.8, uv.y * 1.7, 0.7 + 0.3 * sin(iTime));
    return float4(foundationToneMap(hdr), 1.0);
}
