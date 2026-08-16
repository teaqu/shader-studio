#language slang 2026
module debugfeedback;

public float3 debugFeedbackDecay(float3 sampledHistory, float phase)
{
    float3 accumulated = float3(0.0);

    // Imported modules do not depend on Shader Studio's sampling prelude. This
    // loop operates on the history value passed in by the owning buffer pass.
    for (int index = 0; index < 4; ++index)
    {
        float harmonic = float(index + 1);
        float modulation = 0.97 + 0.005 * sin(phase * harmonic);
        accumulated += sampledHistory * modulation;
    }

    float3 decayed = accumulated * 0.25;
    return decayed;
}
