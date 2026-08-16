#language slang latest
module foundation_version_latest;

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 color = float3(0.07, 0.05, 0.01);
    if (uv.x >= 0.5 && uv.y <= 0.5)
        color = float3(1.0, 0.72, 0.08);
    return float4(color, 1.0);
}
