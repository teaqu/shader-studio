#language slang 2026
module foundation_version_mismatch;

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float selected = float2(uv.x, uv.y).x;
    return float4(selected, 10.0, 0.0, 1.0);
}
