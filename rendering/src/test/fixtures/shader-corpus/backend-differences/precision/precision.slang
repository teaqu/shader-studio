float4 mainImage(float2 p)
{
    float value = sampleIChannel0(p / iResolution.xy).r;
    float expected = float(iFrame + 1) * 0.0001;
    float error = abs(value - expected);
    return float4(saturate(error * 2000.0), saturate(1.0 - error * 2000.0), 0.0, 1.0);
}
