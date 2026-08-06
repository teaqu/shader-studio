[shader("compute")]
[numthreads(64, 1, 1)]
void initializeParticles(uint3 tid : SV_DispatchThreadID)
{
    uint index = tid.x;
    if (index >= PARTICLE_COUNT)
    {
        return;
    }

    float unit = (float(index) + 0.5) / float(PARTICLE_COUNT);
    float angle = TAU * unit;
    float radius = 0.12 + 0.68 * sqrt(particleHash(index));
    float speed = 0.12 + 0.16 * particleHash(index + 701u);
    float2 radial = float2(cos(angle), sin(angle));
    float2 tangent = float2(-radial.y, radial.x);

    positions[index] = float4(radial * radius, 0.0, 1.0);
    velocities[index] = float4(tangent * speed, 0.0, 0.0);
}
