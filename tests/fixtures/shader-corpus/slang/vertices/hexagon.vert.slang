static const float2 points[6] = {
    float2( 0.25, 0.433), float2(-0.25, 0.433),
    float2( 0.5,  0.0),   float2(-0.5,  0.0),
    float2( 0.25,-0.433), float2(-0.25,-0.433)
};

void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
    position = float3(points[vertexIndex] * (0.9 + 0.1 * sin(iTime)), 0.0);
}
