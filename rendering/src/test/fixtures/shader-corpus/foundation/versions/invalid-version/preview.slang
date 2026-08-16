#language slang 2024
module foundation_version_invalid;

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    return float4(uv, 0.25, 1.0);
}
