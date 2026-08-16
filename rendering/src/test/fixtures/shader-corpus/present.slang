// present.slang — compute pass: paint particles to output texture
[shader("compute")]
[numthreads(8, 8, 1)]
void renderParticles(uint3 id : SV_DispatchThreadID)
{
    uint2 size = uint2(iResolution.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }

    float2 uv = (float2(id.xy) + 0.5) / float2(size);
    float3 col = float3(0.02, 0.02, 0.05);

    // Draw each particle as a soft point
    for (uint p = 0; p < 4; p++)
    {
        float4 particle = particles[p * 1024 + (id.x + id.y * 37 + p * 251) % 4096];
        float2 pos = particle.xy * 0.5 + 0.5;
        float d = length(uv - pos);
        float brightness = smoothstep(0.015, 0.001, d) * 0.3;
        float3 pcol = 0.5 + 0.5 * cos(6.28 * (float(p) / 4.0 + float3(0.0, 0.33, 0.67)));
        col += pcol * brightness;
    }

    writeOutput(id.xy, float4(col, 1.0));
}
