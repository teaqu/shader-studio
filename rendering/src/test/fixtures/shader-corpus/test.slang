import shader_studio;

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;

    return float4(uv, 1.0);
}
