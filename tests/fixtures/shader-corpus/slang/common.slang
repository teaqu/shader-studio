// Shared helpers — configured as the "common" pass, prepended to every
// renderable pass (BufferA, BufferB, Image).

float3 palette(float t)
{
    return 1.5 + 0.5 * cos(6.28318 * (t + float3(0.0, 0.33, 0.67)));
}

// Gaussian-ish blob centred at c (pixels), radius r (pixels).
float blob(float2 p, float2 c, float r)
{
    float2 d = p - c;
    return exp(-dot(d, d) / (r * r));
}
