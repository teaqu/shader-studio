[shader("compute")]
[numthreads(8, 8, 1)]
void generateChannel(uint3 tid : SV_DispatchThreadID)
{
    uint2 size = uint2(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y)
    {
        return;
    }

    float2 uv = (float2(tid.xy) + 0.5) / iResolution.xy;
    float waves = 0.5 + 0.5 * sin(uv.x * 18.0 + iTime * 2.0);
    writeOutput(tid.xy, float4(uv.x, waves, uv.y, 1.0));
}
