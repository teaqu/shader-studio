void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
    float line = float(vertexIndex / 2u);
    float end = float(vertexIndex % 2u);
    float angle = line * 0.0041 + iTime * 0.2;
    float radius = 0.2 + 0.6 * end;
    position = float3(cos(angle * 3.0) * radius, sin(angle * 5.0) * radius, 0.0);
}
