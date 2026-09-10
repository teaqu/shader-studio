[shader("compute")]
[numthreads(64, 1, 1)]
void simulateSubstep(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x >= 128u)
    {
        return;
    }

    bool readA = (iDispatch % 2) == 0;
    float4 state = readA ? laneA[tid.x] : laneB[tid.x];
    float2 position = state.xy;
    float2 velocity = state.zw;
    float dt = min(iTimeDelta, 1.0 / 30.0) / 6.0;
    velocity += -0.8 * position * dt;
    position += velocity * dt;
    if (readA) laneB[tid.x] = float4(position, velocity);
    else laneA[tid.x] = float4(position, velocity);
}
