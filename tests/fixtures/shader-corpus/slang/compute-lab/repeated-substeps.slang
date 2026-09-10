static const uint COUNT = 128;

float4 mainImage(float2 fragCoord)
{
    float2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
    float3 color = float3(0.01, 0.015, 0.03);
    for (uint index = 0u; index < COUNT; ++index)
    {
        float2 d = p - laneA[index].xy;
        color += exp(-dot(d, d) * 9000.0) * float3(0.2, 0.75, 1.1);
    }
    return float4(1.0 - exp(-color), 1.0);
}
