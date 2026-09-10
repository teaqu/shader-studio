// init.slang — one-shot: initialize bodies in a ring
[shader("compute")]
[numthreads(64, 1, 1)]
void initBodies(uint3 id : SV_DispatchThreadID)
{
    if (id.x >= 256) { return; }

    float angle = float(id.x) / 256.0 * 6.28318;
    float radius = 0.4;
    float speed = 0.3 / sqrt(radius);

    bodies[id.x].position = float4(cos(angle) * radius, sin(angle) * radius, 0.0, 1.0);
    bodies[id.x].velocity = float4(-sin(angle) * speed, cos(angle) * speed, 0.0, 0.0);
}
