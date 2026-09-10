// Standalone no-mainImage twin of debugfeedback.slang.

vec3 debugFeedbackDecay(vec3 sampledHistory, float phase)
{
    vec3 accumulated = vec3(0.0);

    for (int index = 0; index < 4; ++index)
    {
        float harmonic = float(index + 1);
        float modulation = 0.97 + 0.005 * sin(phase * harmonic);
        accumulated += sampledHistory * modulation;
    }

    vec3 decayed = accumulated * 0.25;
    return decayed;
}
