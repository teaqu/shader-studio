// One native entrypoint per dispatch mode. Open dispatch-modes.slang to view
// all four outputs at once, then adjust a pass's dispatch config in the UI.

[shader("compute")]
[numthreads(8, 8, 1)]
void texelMode(uint3 tid : SV_DispatchThreadID)
{
    uint2 size = uint2(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y) return;
    float2 uv = (float2(tid.xy) + 0.5) / float2(size);
    writeOutput(tid.xy, float4(uv.x, uv.y, 0.2, 1.0));
}

[shader("compute")]
[numthreads(64, 1, 1)]
void countMode(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x >= 256u) return;
    float band = frac(float(tid.x) / 32.0) < 0.5 ? 1.0 : 0.25;
    for (uint y = 0u; y < uint(iResolution.y); ++y)
    {
        writeOutput(uint2(tid.x, y), float4(0.15, band, 0.7 * band, 1.0));
    }
}

[shader("compute")]
[numthreads(16, 8, 1)]
void workgroupsMode(uint3 tid : SV_DispatchThreadID)
{
    uint2 size = uint2(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y) return;
    float checker = float(((tid.x / 16u) + (tid.y / 8u)) % 2u);
    writeOutput(tid.xy, float4(0.85 * checker, 0.25, 1.0 - 0.6 * checker, 1.0));
}

[shader("compute")]
[numthreads(16, 1, 1)]
void coverStorageMode(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x >= 128u) return;
    coverageItems[tid.x] = float(tid.x) / 127.0;
    uint x = tid.x * 2u;
    float value = coverageItems[tid.x];
    for (uint y = 0u; y < uint(iResolution.y); ++y)
    {
        float shade = 0.3 + 0.7 * value;
        writeOutput(uint2(x, y), float4(shade, 0.45 * shade, 0.08, 1.0));
        writeOutput(uint2(x + 1u, y), float4(shade, 0.45 * shade, 0.08, 1.0));
    }
}
