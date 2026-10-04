// Slang vertex-hook IntelliSense fixture.
void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv)
{
    position.xy += (uv - 0.5) * 0.02;
    normal = normalize(normal);
    uv = saturate(uv);
}
