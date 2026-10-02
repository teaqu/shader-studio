void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
    float line = float(vertexIndex / 2);
    float end = float(vertexIndex % 2);
    float angle = line * 0.0041 + iTime * 0.2;
    float radius = 0.2 + 0.6 * end;
    position = vec3(cos(angle * 3.0) * radius, sin(angle * 5.0) * radius, 0.0);
}
