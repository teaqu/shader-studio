static const uint BODY_COUNT = 256;

float4 mainImage(float2 fragCoord)
{
    float2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
    float3 color = float3(0.01, 0.015, 0.035);

    // Six dispatches finish in laneA: dispatch 0 writes B, dispatch 1 writes A,
    // and the pattern repeats. Image runs after compute and sees this frame's A.
    for (uint index = 0; index < BODY_COUNT; ++index)
    {
        float2 delta = p - laneA[index].xy;
        float glow = exp(-dot(delta, delta) * 12000.0);
        color += glow * float3(0.2, 0.7, 1.2);
    }

    return float4(1.0 - exp(-color), 1.0);
}
