// present.slang — compute pass: render bodies to output texture
[shader("compute")]
[numthreads(8, 8, 1)]
void renderBodies(uint3 id : SV_DispatchThreadID)
{
    uint2 size = uint2(iResolution.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }

    float2 uv = (float2(id.xy) + 0.5) / float2(size);
    float3 col = float3(0.01, 0.01, 0.03);

    for (uint i = 0; i < 256; i++)
    {
        float2 pos = bodies[i].position.xy * 0.5 + 0.5;
        float d = length(uv - pos);
        float brightness = smoothstep(0.012, 0.001, d) * (bodies[i].position.w * 0.1);
        float3 bcol = 0.5 + 0.5 * cos(6.28 * (float(i) / 256.0 + float3(0.0, 0.33, 0.67)));
        col += bcol * brightness;
    }

    writeOutput(id.xy, float4(col, 1.0));
}
