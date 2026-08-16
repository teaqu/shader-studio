float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0.0, 2.0, 4.0));
    return float4(col, 1.0);
}
