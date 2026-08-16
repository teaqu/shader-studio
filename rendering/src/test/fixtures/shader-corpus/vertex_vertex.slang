// The fullscreen wrapper calls this hook for each vertex. vertexTransform is
// initialized by ComputeInit and read here from render-stage storage. iChannel3
// verifies that vertex hooks can sample their pass's configured channels.
void mainVertex(inout float3 position, inout float3 normal, inout float2 uv)
{
    float4 transform = vertexTransform[0];
    position.xy = position.xy * transform.xy + transform.zw;

    float3 channelColor = sampleIChannel3(uv).rgb;
    position.xy += (channelColor.rg - 0.5) * 0.16;
}
