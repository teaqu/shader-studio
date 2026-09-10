#language slang 2026
module debugmath;

public float debugWave(float phase)
{
    float accumulated = 0.0;

    // Inspect index, harmonic, contribution, and accumulated while stepping here.
    for (int index = 0; index < 4; ++index)
    {
        float harmonic = float(index + 1);
        float contribution = sin(phase * harmonic * 6.2831853) / harmonic;
        accumulated += contribution;
    }

    float result = saturate(0.5 + accumulated * 0.22);
    return result;
}
