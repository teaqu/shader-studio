void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
    float x = -0.9 + 1.8 * float(vertexIndex) / float(iVertexCount - 1u);
    float y = 0.5 * sin(x * 6.0 + iTime * 2.0) * cos(x * 1.5 - iTime);
    position = float3(x, y, 0.0);
}
