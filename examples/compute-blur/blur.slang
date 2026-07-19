float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    return sampleIChannel0(uv);
}
