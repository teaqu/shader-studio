void mainVertex(inout float3 position, inout float3 normal, inout float2 uv)
{
    float2 channelOffset = inputs.patternTex.SampleLevel(uv, 0.0).rg - 0.5;
    position.xy += channelOffset * 0.04;
}
