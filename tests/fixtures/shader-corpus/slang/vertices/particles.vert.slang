static const float2 corners[6] = { float2(-1, -1), float2(1, -1), float2(-1, 1), float2(-1, 1), float2(1, -1), float2(1, 1) };

void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
    float id = float(vertexIndex / 6u);
    float2 corner = corners[vertexIndex % 6u];
    float3 centre = float3(sin(id * 1.7 + iTime), cos(id * 2.3 + iTime * 0.5), sin(id * 0.9)) * 0.8;
    position = centre + float3(corner * 0.04, 0.0);
    uv = corner * 0.5 + 0.5;
}
