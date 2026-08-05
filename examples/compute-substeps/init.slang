static const uint BODY_COUNT = 256;
static const float TAU = 6.28318530718;

void computeMain(uint3 tid)
{
    uint index = tid.x;
    if (index >= BODY_COUNT)
    {
        return;
    }

    float angle = TAU * (float(index) + 0.5) / float(BODY_COUNT);
    float radius = 0.22 + 0.55 * frac(float(index) * 0.61803398875);
    float2 position = radius * float2(cos(angle), sin(angle));
    float2 velocity = 0.35 * float2(-position.y, position.x);
    float4 state = float4(position, velocity);
    laneA[index] = state;
    laneB[index] = state;
}
