// sim.slang — per-frame compute: integrate gravity
[shader("compute")]
[numthreads(64, 1, 1)]
void simulateBodies(uint3 id : SV_DispatchThreadID)
{
    // One invocation serializes this deliberately small corpus fixture. It
    // snapshots the force inputs so each of the four configured substeps has
    // deterministic simultaneous-update semantics without a storage race.
    if (id.x != 0) { return; }

    Body forceSources[32];
    for (uint source = 0; source < 32; source++)
    {
        forceSources[source] = bodies[source];
    }

    for (uint body = 0; body < 256; body++)
    {
        Body current = bodies[body];
        if (body < 32)
        {
            current = forceSources[body];
        }

        // N-body gravity (simplified — only from the first 32 bodies)
        float3 force = float3(0, 0, 0);
        for (uint j = 0; j < 32; j++)
        {
            if (j == body) { continue; }
            force += gravityForce(current, forceSources[j]);
        }

        current.velocity.xyz += force * 0.0001;
        current.position.xyz += current.velocity.xyz * 0.0001;

        bodies[body] = current;
    }
}
