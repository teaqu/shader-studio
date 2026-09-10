#language slang 2026
module foundation_workspace_glow;
import "../lib/palette.slang";
#include "../include/blur.slang"

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 glow = foundationBlurHistory(uv);
    glow *= 2.82 + 0.18 * foundationPalette(iTime * 0.05);
    return float4(glow, 1.0);
}
