const vec2 corners[6] = vec2[6](vec2(-1, -1), vec2(1, -1), vec2(-1, 1), vec2(-1, 1), vec2(1, -1), vec2(1, 1));

void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
    int quad = vertexIndex / 6;
    vec2 corner = corners[vertexIndex % 6];
    position = vec3(corner * 0.5 + (quad == 0 ? vec2(-0.2, 0.1) : vec2(0.2, -0.1)), quad == 0 ? 0.4 : -0.4);
    uv = vec2(float(quad), 0.0);
}
