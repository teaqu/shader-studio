// One cube drawn 100 times ("instanceCount": 100): iInstanceIndex places each copy on a 10 x 10 grid.
void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
    vec2 cell = vec2(iInstanceIndex % 10, iInstanceIndex / 10) - 4.5;
    float height = 0.5 + 0.5 * sin(cell.x * 0.7 + cell.y * 1.3);
    position = position * vec3(0.07, 0.07 + 0.2 * height, 0.07) + vec3(cell.x * 0.2, 0.0, cell.y * 0.2);
}
