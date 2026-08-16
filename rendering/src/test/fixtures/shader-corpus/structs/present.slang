// present.slang — compute pass: visualize struct data as colored bands
[shader("compute")]
[numthreads(8, 8, 1)]
void renderStructs(uint3 id : SV_DispatchThreadID)
{
    uint2 size = uint2(iResolution.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }

    float2 uv = float2(id.xy) / float2(size);

    // Background
    float3 col = float3(0.01, 0.01, 0.03);

    // Band layout: each struct type gets a horizontal band
    float band = uv.y * 5.0;
    uint bandIndex = uint(floor(band));
    float bandFrac = frac(band);

    // Sample a particle from the corresponding storage buffer
    float4 sample = float4(0, 0, 0, 0);
    switch (bandIndex)
    {
    case 0: // Particle band
        {
            uint idx = uint(uv.x * 64.0);
            float2 pos2d = particles[idx].position.xy * 0.5 + 0.5;
            float2 vel2d = particles[idx].velocity.xy * 0.2 + 0.5;
            sample = float4(pos2d.x, pos2d.y, vel2d.x, vel2d.y);
        }
        break;
    case 1: // ColoredParticle band
        {
            uint idx = uint(uv.x * 32.0);
            sample = colored[idx].color;
        }
        break;
    case 2: // MixedLayout band
        {
            uint idx = uint(uv.x * 16.0);
            sample = float4(mixed[idx].direction * 0.5 + 0.5, mixed[idx].lifetime);
        }
        break;
    case 3: // Transform band
        {
            uint idx = uint(uv.x * 16.0);
            sample = float4(transforms[idx].modelMatrix[0].xyz * 0.5 + 0.5, 1.0);
        }
        break;
    case 4: // RigidBody band
        {
            uint idx = uint(uv.x * 8.0);
            sample = float4(rigid[idx].angularVelocity.xyz * 0.3 + 0.5, 1);
        }
        break;
    }

    // Blend sample into the column
    float edge = 1.0 - abs(bandFrac - 0.5) * 2.0;
    col = lerp(col, sample.rgb, smoothstep(0.0, 0.02, edge));

    writeOutput(id.xy, float4(col, 1.0));
}
