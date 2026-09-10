[shader("compute")]
[numthreads(64, 1, 1)]
void initializeSubsteps(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x >= 128u)
    {
        return;
    }

    float angle = 6.2831853 * float(tid.x) / 128.0;
    float2 position = 0.48 * float2(cos(angle), sin(angle));
    float2 velocity = 0.3 * float2(-position.y, position.x);
    laneA[tid.x] = float4(position, velocity);
    laneB[tid.x] = float4(position, velocity);
}
