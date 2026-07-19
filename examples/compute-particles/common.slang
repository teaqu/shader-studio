static const uint PARTICLE_COUNT = 512;
static const float TAU = 6.28318530718;

float particleHash(uint value)
{
    return frac(sin(float(value) * 91.3458) * 47453.5453);
}

float4 renderParticles(float2 fragCoord)
{
    float2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
    float3 color = float3(0.012, 0.018, 0.04);

    for (uint index = 0; index < PARTICLE_COUNT; ++index)
    {
        float2 delta = p - positions[index].xy;
        float glow = exp(-dot(delta, delta) * 18000.0);
        float hue = float(index) / float(PARTICLE_COUNT);
        float3 tint = 0.55 + 0.45 * cos(TAU * (hue + float3(0.0, 0.33, 0.67)));
        color += glow * tint;
    }

    return float4(1.0 - exp(-color), 1.0);
}
