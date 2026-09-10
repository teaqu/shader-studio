// init.slang — one-shot compute pass: initialize particle positions
[shader("compute")]
[numthreads(64, 1, 1)]
void initParticles(uint3 id : SV_DispatchThreadID)
{
    if (id.x >= 4096) { return; }

    float t = float(id.x) / 4096.0;
    particles[id.x] = float4(
        cos(t * 6.28318 * 3.0),
        sin(t * 6.28318 * 5.0),
        cos(t * 6.28318 * 2.0),
        1.0
    );
}
