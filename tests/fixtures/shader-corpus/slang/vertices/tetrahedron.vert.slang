static const float3 corners[4] = { float3(1, 1, 1), float3(1, -1, -1), float3(-1, 1, -1), float3(-1, -1, 1) };
static const uint faces[12] = { 0, 1, 2,  0, 3, 1,  0, 2, 3,  1, 3, 2 };

float3 spin(float3 p) {
    float c = cos(iTime * 0.5);
    float s = sin(iTime * 0.5);
    return float3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
    uint face = vertexIndex / 3u;
    float3 a = corners[faces[face * 3u]];
    float3 b = corners[faces[face * 3u + 1u]];
    float3 c = corners[faces[face * 3u + 2u]];
    position = spin(corners[faces[vertexIndex]] * 0.6);
    normal = spin(normalize(cross(b - a, c - a)));
}
