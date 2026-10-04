static const float2 corners[6] = { float2(-1, -1), float2(1, -1), float2(-1, 1), float2(-1, 1), float2(1, -1), float2(1, 1) };

void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
    uint disc = vertexIndex / 6u;
    float2 corner = corners[vertexIndex % 6u];
    float angle = float(disc) * 2.094 + iTime * 0.5;
    position = float3(float2(cos(angle), sin(angle)) * 0.3 + corner * 0.45, float(disc) * 0.05);
    float2 local = corner * 0.5 + 0.5;
    uv = float2((float(disc) + clamp(local.x, 0.001, 0.999)) / 3.0, local.y);
}
