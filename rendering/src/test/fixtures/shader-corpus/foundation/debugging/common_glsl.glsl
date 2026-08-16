// Configured GLSL common source, prepended to Image and BufferA.

float debugVignette(vec2 uv)
{
    vec2 centered = uv * 2.0 - 1.0;
    float radiusSquared = dot(centered, centered);
    float vignette = 1.0 - 0.28 * radiusSquared;
    return clamp(vignette, 0.0, 1.0);
}

vec3 debugToneMap(vec3 color)
{
    float exposure = 1.2;
    vec3 mapped = 1.0 - exp(-color * exposure);
    return mapped;
}
