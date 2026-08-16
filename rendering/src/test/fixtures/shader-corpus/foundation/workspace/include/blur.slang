// Textual include: intentionally inherits its including root's language mode.
static const int kFoundationBlurRadius = 2;

float3 foundationBlurHistory(float2 uv)
{
    float3 sum = float3(0.0);
    int sampleCount = 0;
    for (int y = -kFoundationBlurRadius; y <= kFoundationBlurRadius; ++y)
    {
        for (int x = -kFoundationBlurRadius; x <= kFoundationBlurRadius; ++x)
        {
            float2 offset = float2(float(x), float(y)) / iResolution.xy * 2.0;
            sum += sampleIChannel0(uv + offset).rgb;
            sampleCount += 1;
        }
    }
    return sum / float(sampleCount);
}
