float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    return float4(uv, iDayOfWeek, 1.0);
}
