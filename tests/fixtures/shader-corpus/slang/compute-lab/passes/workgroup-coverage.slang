[shader("compute")]
[numthreads(12, 8, 1)]
void coverageKernel(uint3 tid : SV_DispatchThreadID)
{
    uint2 size = uint2(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y)
    {
        return;
    }

    float2 uv = (float2(tid.xy) + 0.5) / iResolution.xy;
    float checker = frac(floor(uv.x * 20.0) + floor(uv.y * 12.0)) * 2.0;
    writeOutput(tid.xy, float4(0.1 + 0.75 * uv.x, 0.25 + 0.65 * uv.y, 0.35 + 0.4 * checker, 1.0));
}
