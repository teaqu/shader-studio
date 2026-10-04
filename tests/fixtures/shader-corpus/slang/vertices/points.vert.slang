void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
    float2 cell = float2(float(vertexIndex % 32u), float(vertexIndex / 32u)) / 31.0 * 1.6 - 0.8;
    float angle = length(cell) * 2.0 - iTime * 0.5;
    float c = cos(angle);
    float s = sin(angle);
    position = float3(cell.x * c - cell.y * s, cell.x * s + cell.y * c, 0.0);
}
