static const uint BODY_COUNT = 256;
static const int SUBSTEP_COUNT = 6;

[shader("compute")]
[numthreads(64, 1, 1)]
void simulateSubstep(uint3 tid : SV_DispatchThreadID)
{
    uint index = tid.x;
    if (index >= BODY_COUNT)
    {
        return;
    }

    bool readA = (iDispatch % 2) == 0;
    float4 state = readA ? laneA[index] : laneB[index];
    float2 position = state.xy;
    float2 velocity = state.zw;
    float dt = min(iTimeDelta, 1.0 / 30.0) / float(SUBSTEP_COUNT);

    velocity += -0.8 * position * dt;
    position += velocity * dt;
    float4 nextState = float4(position, velocity);

    if (readA)
    {
        laneB[index] = nextState;
    }
    else
    {
        laneA[index] = nextState;
    }
}
