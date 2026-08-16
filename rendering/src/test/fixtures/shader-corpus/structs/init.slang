// init.slang — one-shot: initialize all struct types with test data
[shader("compute")]
[numthreads(64, 1, 1)]
void initStructs(uint3 id : SV_DispatchThreadID)
{
    // Particle (32 bytes): position + velocity
    if (id.x < 64)
    {
        float t = float(id.x) / 64.0;
        particles[id.x].position = float4(cos(t * 6.28), sin(t * 6.28), 0, 1);
        particles[id.x].velocity = float4(-sin(t * 6.28), cos(t * 6.28), 0, 0);
    }

    // ColoredParticle (48 bytes): position + velocity + color
    if (id.x < 32)
    {
        colored[id.x].position = float4(0, 0, 0, 1);
        colored[id.x].velocity = float4(0, 0, 0, 0);
        float hue = float(id.x) / 32.0;
        float3 rgb = 0.5 + 0.5 * cos(6.28 * (hue + float3(0.0, 0.33, 0.67)));
        colored[id.x].color = float4(rgb, 1.0);
    }

    // MixedLayout (48 bytes): float3 + float + float4
    if (id.x < 16)
    {
        mixed[id.x].direction = normalize(float3(
            cos(float(id.x) * 0.5),
            sin(float(id.x) * 0.7),
            0.5
        ));
        mixed[id.x].lifetime = float(id.x) / 16.0;
        mixed[id.x].extra = float4(1, 0, 0, 1);
    }

    // Transform (64 bytes): float4x4
    if (id.x < 16)
    {
        float angle = float(id.x) / 16.0 * 6.28;
        float c = cos(angle);
        float s = sin(angle);
        transforms[id.x].modelMatrix = float4x4(
            float4( c,  s, 0, 0),
            float4(-s,  c, 0, 0),
            float4( 0,  0, 1, 0),
            float4( 0,  0, 0, 1)
        );
    }

    // RigidBody (80 bytes): float4x4 + float4
    if (id.x < 8)
    {
        rigid[id.x].transform = transforms[id.x % 16].modelMatrix;
        rigid[id.x].angularVelocity = float4(1, 0.5, 0.25, 0);
    }
}
