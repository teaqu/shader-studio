[shader("compute")]
[numthreads(64, 1, 1)]
void writeGradient(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x >= 256u)
    {
        return;
    }

    float phase = 0.5 + 0.5 * sin(iTime + float(tid.x) * 0.11);
    samples[tid.x] = phase;
}
