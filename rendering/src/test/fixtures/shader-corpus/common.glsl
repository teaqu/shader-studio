// Shared helpers - configured as the "common" pass, prepended to every
// renderable pass (BufferA, BufferB, Image).

vec3 palette(float t)
{
    return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
}

// Gaussian-ish blob centred at c (pixels), radius r (pixels).
float blob(vec2 p, vec2 c, float r)
{
    vec2 d = p - c;
    return exp(-dot(d, d) / (r * r));
}
