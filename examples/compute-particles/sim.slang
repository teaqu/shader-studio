[shader("compute")]
[numthreads(64, 1, 1)]
void simulateParticles(uint3 tid : SV_DispatchThreadID)
{
    uint index = tid.x;
    if (index >= PARTICLE_COUNT)
    {
        return;
    }

    float dt = min(iTimeDelta, 1.0 / 30.0);
    float2 position = positions[index].xy;
    float2 velocity = velocities[index].xy;

    float radiusSquared = max(dot(position, position), 0.0025);
    float2 acceleration = -0.055 * position / (radiusSquared * sqrt(radiusSquared));
    velocity += acceleration * dt;
    position += velocity * dt;

    positions[index] = float4(position, 0.0, 1.0);
    velocities[index] = float4(velocity, 0.0, 0.0);
}
