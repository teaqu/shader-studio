float3 debugHelper(float2 uv, float gain, float bias)
{
    float harmonic = 0.0;
    for (int iteration = 0; iteration < 6; iteration++)
        harmonic = harmonic + sin((float(iteration) + 1.0) * uv.x * 6.2831853 + iTime) / (float(iteration) + 1.0);

    float shaped = harmonic * gain + bias;
    return parityPalette(shaped);
}

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float pulse = 0.5 + 0.5 * sin(iTime), grid = parityGrid(uv, 12.0);
    float3 helperColor = debugHelper(uv, 0.55, 0.2);
    float3 feedback = inputs.iChannel0.Sample(uv).rgb;
    float3 computeColor = inputs.iChannel1.Sample(uv).rgb;
    float3 color = lerp(feedback, computeColor, 0.35) + helperColor * (0.12 + grid * 0.08);
    uint2 slot15Size = inputs.iChannel15.size;
    bool slot15Ready = inputs.iChannel15.loaded && slot15Size.x > 0 && slot15Size.y > 0;
    float3 slot15Sample = inputs.iChannel15.Sample(uv).rgb;

    if (uv.x > 0.72 && uv.y > 0.72)
        color = slot15Sample;
    if (uv.x > 0.72 && uv.y > 0.68 && uv.y <= 0.72)
        color = slot15Ready ? float3(0.1, 1.0, 0.2) : float3(1.0, 0.05, 0.05);
    if (abs(uv.x - pulse) < 0.003)
        color = float3(1.0);

    return float4(color, 1.0);
}
