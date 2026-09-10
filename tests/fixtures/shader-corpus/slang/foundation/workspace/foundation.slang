#language slang 2026
module foundation_workspace_image;
import lib.palette;
#include "include/tone-map.slang"

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 history = inputs.iChannel0.Sample(uv).rgb;
    float3 glow = inputs.iChannel1.Sample(uv).rgb;
    float3 color = foundationToneMap(history + glow * 0.75);
    color += foundationPalette(uv.x + iTime * 0.02) * 0.025;

    // Orientation contract: RED is TOP, GREEN is LEFT.
    if (uv.y > 0.985)
        color = float3(14.0, 0.0, 0.0);
    if (uv.x < 0.008)
        color = float3(0.0, 1.0, 0.0);

    return float4(color, 1.0);
}
