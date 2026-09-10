// Standalone no-mainImage twin of debugmath.slang.
// Use this file to test unlocked navigation away from a running GLSL shader.

float debugWave(float phase)
{
    float accumulated = 0.0;

    for (int index = 0; index < 4; ++index)
    {
        float harmonic = float(index + 1);
        float contribution = sin(phase * harmonic * 6.2831853) / harmonic;
        accumulated += contribution;
    }

    float result = clamp(0.5 + accumulated * 0.22, 0.0, 1.0);
    return result;
}
