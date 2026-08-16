// GLSL twin of debug-coverage.slang.
// Slang imports are intentionally flattened into this root shader.

float debugWave(float phase)
{
    float accumulated = 0.0;

    // Inspect index, harmonic, contribution, and accumulated while stepping here.
    for (int index = 0; index < 4; ++index)
    {
        float harmonic = float(index + 1);
        float contribution = sin(phase * harmonic * 6.2831853) / harmonic;
        accumulated += contribution;
    }

    float result = clamp(0.5 + accumulated * 0.22, 0.0, 1.0);
    return result;
}

vec3 debugPalette(float phase)
{
    float blend = debugWave(phase);
    vec3 coolColor = vec3(0.03, 0.22, 1.0);
    vec3 warmColor = vec3(1.0, 0.12, 0.38);
    vec3 color = mix(coolColor, warmColor, blend);
    return color;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec3 history = texture(iChannel0, uv).rgb;

    float phase = uv.x * 1.75 + uv.y * 0.5 + iTime * 0.08;
    vec3 paletteColor = debugPalette(phase);
    float scanline = 0.75 + 0.25 * sin(uv.y * iResolution.y * 0.16 + iTime * 3.0);

    vec3 mixedColor = mix(history, paletteColor, 0.28) * scanline;
    float vignette = debugVignette(uv);
    vec3 finalColor = debugToneMap(mixedColor * vignette);

    fragColor = vec4(finalColor, 1.0);
}
