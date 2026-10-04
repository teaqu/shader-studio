// One cube drawn 100 times ("instanceCount": 100): iInstanceIndex places each copy on a 10 x 10 grid.
void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
    float2 cell = float2(float(iInstanceIndex % 10u), float(iInstanceIndex / 10u)) - 4.5;
    float height = 0.5 + 0.5 * sin(cell.x * 0.7 + cell.y * 1.3);
    position = position * float3(0.07, 0.07 + 0.2 * height, 0.07) + float3(cell.x * 0.2, 0.0, cell.y * 0.2);
}
