float4 mainImage(float2 fragCoord)
{
    float2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
    float x = clamp((p.x + 1.6) * 80.0, 0.0, 255.0);
    uint index = uint(x);
    float value = samples[index];
    return float4(value, 0.2 + 0.8 * (1.0 - value), 1.0 - value, 1.0);
}
