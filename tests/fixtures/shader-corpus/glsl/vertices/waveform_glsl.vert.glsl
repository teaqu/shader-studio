void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
    float x = -0.9 + 1.8 * float(vertexIndex) / float(iVertexCount - 1);
    float y = 0.5 * sin(x * 6.0 + iTime * 2.0) * cos(x * 1.5 - iTime);
    position = vec3(x, y, 0.0);
}
