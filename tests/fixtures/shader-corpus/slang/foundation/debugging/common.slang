// Configured common source. It is prepended to both Image and BufferA.
// Keep this file directive- and module-free so it inherits each owning root.

float debugVignette(float2 uv)
{
    float2 centered = uv * 2.0 - 1.0;
    float radiusSquared = dot(centered, centered);
    float vignette = 1.0 - 0.28 * radiusSquared;
    return saturate(vignette);
}

float3 debugToneMap(float3 color)
{
    float exposure = 1.2;
    float3 mapped = 1.0 - exp(-color * exposure);
    return mapped;
}
