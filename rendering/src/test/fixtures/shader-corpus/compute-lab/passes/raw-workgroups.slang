[shader("compute")]
[numthreads(1, 1, 1)]
void drawWorkgroupGrid(uint3 tid : SV_DispatchThreadID)
{
    uint2 size = uint2(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y)
    {
        return;
    }

    float2 uv = (float2(tid.xy) + 0.5) / iResolution.xy;
    float grid = step(0.94, frac(uv.x * 8.0)) + step(0.94, frac(uv.y * 4.0));
    writeOutput(tid.xy, float4(uv.x, uv.y, 0.35 + 0.4 * grid, 1.0));
}
