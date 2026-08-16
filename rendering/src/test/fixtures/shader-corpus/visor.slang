float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float scanline = 3.75 + 0.25 * sin(uv.y * 220.0 + iTime * 8.0);
    return float4(float3(1.0, 0.48, 0.08) * scanline, 1.0);
}
