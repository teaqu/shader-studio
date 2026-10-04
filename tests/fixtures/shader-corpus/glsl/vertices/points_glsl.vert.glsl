void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
    vec2 cell = vec2(float(vertexIndex % 32), float(vertexIndex / 32)) / 31.0 * 1.6 - 0.8;
    float angle = length(cell) * 2.0 - iTime * 0.5;
    position = vec3(mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * cell, 0.0);
}
