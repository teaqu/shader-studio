// Slang compute IntelliSense fixture.
// Hover both attributes and each SV_* semantic to inspect its documentation.

[shader("compute")]
[numthreads(4, 4, 1)]
void computeIntellisense(
    uint3 dispatchId : SV_DispatchThreadID,
    uint3 groupId : SV_GroupID,
    uint3 localId : SV_GroupThreadID,
    uint groupIndex : SV_GroupIndex)
{
    uint2 size = uint2(iResolution.xy);
    if (dispatchId.x >= size.x || dispatchId.y >= size.y)
        return;

    float3 color = float3(
        float(groupId.x & 15u) / 15.0,
        float(groupId.y & 15u) / 15.0,
        float(groupIndex + localId.x + localId.y) / 31.0);
    writeOutput(dispatchId.xy, float4(color, 1.0));
}
