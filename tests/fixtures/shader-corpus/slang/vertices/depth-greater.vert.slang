static const float2 corners[6] = { float2(-1, -1), float2(1, -1), float2(-1, 1), float2(-1, 1), float2(1, -1), float2(1, 1) };

void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
    uint quad = vertexIndex / 6u;
    float2 corner = corners[vertexIndex % 6u];
    position = float3(corner * 0.5 + (quad == 0u ? float2(-0.2, 0.1) : float2(0.2, -0.1)), quad == 0u ? 0.4 : -0.4);
    uv = float2(float(quad), 0.0);
}
