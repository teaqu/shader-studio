#language slang 2026
module foundation_version_2026;

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 color = float3(0.02, 0.03, 0.08);
    if (uv.x < 0.5 && uv.y <= 0.5)
        color = float3(0.12, 0.38, 1.0);
    return float4(color, 1.0);
}
