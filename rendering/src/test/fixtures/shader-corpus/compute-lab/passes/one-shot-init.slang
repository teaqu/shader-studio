[shader("compute")]
[numthreads(1, 1, 1)]
void initializeOnce(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x != 0u)
    {
        return;
    }

    // A stable, visible value proves this only changes after Reset/recompile.
    seed[0] = float4(0.0, 0.0, 0.0, 1.0);
}
