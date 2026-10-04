const vec2 corners[6] = vec2[6](vec2(-1, -1), vec2(1, -1), vec2(-1, 1), vec2(-1, 1), vec2(1, -1), vec2(1, 1));

void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
    float id = float(vertexIndex / 6);
    vec2 corner = corners[vertexIndex % 6];
    vec3 centre = vec3(sin(id * 1.7 + iTime), cos(id * 2.3 + iTime * 0.5), sin(id * 0.9)) * 0.8;
    position = centre + vec3(corner * 0.04, 0.0);
    uv = corner * 0.5 + 0.5;
}
