float3 sourceColor(float2 uv)
{
    float2 cell = floor(uv * 20.0);
    float checker = frac((cell.x + cell.y) * 0.5) * 2.0;
    float2 center = 0.5 + 0.22 * float2(cos(iTime), sin(iTime * 1.3));
    float disc = smoothstep(0.17, 0.15, length(uv - center));
    return lerp(float3(0.04, 0.08, 0.16), float3(0.85, 0.32, 0.08), checker)
        + disc * float3(0.1, 0.7, 1.4);
}

void computeMain(uint3 tid)
{
    uint2 size = uint2(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y)
    {
        return;
    }

    uint2 coord = tid.xy;
    float2 uv = (float2(coord) + 0.5) / iResolution.xy;
    float2 texel = 1.0 / iResolution.xy;
    float3 blurred = float3(0.0);
    float totalWeight = 0.0;

    for (int y = -2; y <= 2; ++y)
    {
        for (int x = -2; x <= 2; ++x)
        {
            float weight = 1.0 / (1.0 + float(x * x + y * y));
            blurred += sourceColor(uv + float2(float(x), float(y)) * texel) * weight;
            totalWeight += weight;
        }
    }

    writeOutput(coord, 0u, float4(sourceColor(uv), 1.0));
    writeOutput(coord, 1u, float4(blurred / totalWeight, 1.0));
}
