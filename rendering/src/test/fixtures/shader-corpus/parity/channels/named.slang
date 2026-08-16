float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 sampled = sampleAlbedo(uv).rgb;
    return float4(sampled, 1.0);
}
