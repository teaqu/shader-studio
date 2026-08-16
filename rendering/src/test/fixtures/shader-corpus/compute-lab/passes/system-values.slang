// Every parameter is a native Slang system value. The colours make their
// relationship visible: red/green are global dispatch coordinates, blue is
// the linear local-workgroup index, and the alternating tint is workgroup ID.
[shader("compute")]
[numthreads(8, 8, 1)]
void systemValues(
    uint3 dispatchId : SV_DispatchThreadID,
    uint3 groupId : SV_GroupID,
    uint3 localId : SV_GroupThreadID,
    uint localIndex : SV_GroupIndex)
{
    uint2 size = uint2(iResolution.xy);
    if (dispatchId.x >= size.x || dispatchId.y >= size.y)
    {
        return;
    }

    float2 uv = (float2(dispatchId.xy) + 0.5) / float2(size);
    float local = float(localIndex) / 63.0;
    float checker = float((groupId.x + groupId.y) % 2u);
    float3 color = float3(uv, local);
    color = lerp(color, color.yzx, 0.25 * checker);
    color += 0.04 * float3(float2(localId.xy), 0.0);
    writeOutput(dispatchId.xy, float4(color, 1.0));
}
