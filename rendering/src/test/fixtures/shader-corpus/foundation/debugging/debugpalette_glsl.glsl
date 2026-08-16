// Standalone no-mainImage twin of debugpalette.slang.
// debugWave is duplicated because GLSL imports are intentionally not used.

float debugWave(float phase)
{
    float accumulated = 0.0;
    for (int index = 0; index < 4; ++index)
    {
        float harmonic = float(index + 1);
        accumulated += sin(phase * harmonic * 6.2831853) / harmonic;
    }
    return clamp(0.5 + accumulated * 0.22, 0.0, 1.0);
}

vec3 debugPalette(float phase)
{
    float blend = debugWave(phase);
    vec3 coolColor = vec3(0.03, 0.22, 1.0);
    vec3 warmColor = vec3(1.0, 0.12, 0.38);
    vec3 color = mix(coolColor, warmColor, blend);
    return color;
}
