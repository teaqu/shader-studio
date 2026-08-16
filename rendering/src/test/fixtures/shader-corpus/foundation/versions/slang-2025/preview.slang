#language slang 2025
module foundation_version_2025;

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 color = float3(0.02, 0.06, 0.02);
    if (uv.x >= 0.5 && uv.y > 0.5)
        color = float3(0.18, 1.0, 0.22);
    return float4(color, 1.0);
}
