float4 mainImage(float2 fragCoord)
{
    return sampleIChannel0(fragCoord / iResolution.xy);
}
