// sim.slang — per-frame compute: integrate gravity
[shader("compute")]
[numthreads(64, 1, 1)]
void simulateBodies(uint3 id : SV_DispatchThreadID)
{
    if (id.x >= 256) { return; }

    Body current = bodies[id.x];

    // N-body gravity (simplified — only from the first 32 bodies)
    float3 force = float3(0, 0, 0);
    for (uint j = 0; j < 32; j++)
    {
        if (j == id.x) { continue; }
        force += gravityForce(current, bodies[j]);
    }

    current.velocity.xyz += force * 0.0001;
    current.position.xyz += current.velocity.xyz * 0.0001;

    bodies[id.x] = current;
}
