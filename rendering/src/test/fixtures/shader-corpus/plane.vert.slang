void mainVertex(inout float3 position, inout float3 normal, inout float2 uv)
{
    float wave = sin(position.x * 5.0 + iTime) *
                 cos(position.z * 5.0 + iTime) * 0.2;
    position.y += wave;
}
