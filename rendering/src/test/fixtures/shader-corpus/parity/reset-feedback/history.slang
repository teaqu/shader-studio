float4 mainImage(float2 p)
{
    float4 previous = sampleIChannel0(p / iResolution.xy);
    if (iFrame == 0) return length(previous.rgb) < 0.001 ? float4(0.0, 0.8, 0.1, 1.0) : float4(0.9, 0.0, 0.0, 1.0);
    return lerp(previous, float4(0.05, 0.15, 0.9, 1.0), 0.025);
}
