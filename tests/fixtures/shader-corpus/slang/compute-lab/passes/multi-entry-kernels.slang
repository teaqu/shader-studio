[shader("compute")]
[numthreads(64, 1, 1)]
void clearSamples(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x < 256u)
    {
        samples[tid.x] = 0.0;
    }
}

[shader("compute")]
[numthreads(64, 1, 1)]
void animateSamples(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x < 256u)
    {
        float phase = 0.5 + 0.5 * sin(iTime * 2.0 + float(tid.x) * 0.09);
        samples[tid.x] = phase;
    }
}
