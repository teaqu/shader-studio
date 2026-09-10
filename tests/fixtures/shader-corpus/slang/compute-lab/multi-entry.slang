float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    uint index = min(uint(uv.x * 256.0), 255u);
    float value = samples[index];
    return float4(value, 0.25 + 0.75 * (1.0 - value), 1.0 - value, 1.0);
}
