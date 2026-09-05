float4 mainImage(float2 p)
{
    float previous = inputs.iChannel0.Sample(p / iResolution.xy).r;
    return float4(previous + 0.0001, 0.0, 0.0, 1.0);
}
