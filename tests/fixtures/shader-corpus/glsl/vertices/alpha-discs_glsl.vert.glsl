const vec2 corners[6] = vec2[6](vec2(-1, -1), vec2(1, -1), vec2(-1, 1), vec2(-1, 1), vec2(1, -1), vec2(1, 1));

void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
    int disc = vertexIndex / 6;
    vec2 corner = corners[vertexIndex % 6];
    float angle = float(disc) * 2.094 + iTime * 0.5;
    position = vec3(vec2(cos(angle), sin(angle)) * 0.3 + corner * 0.45, float(disc) * 0.05);
    vec2 local = corner * 0.5 + 0.5;
    uv = vec2((float(disc) + clamp(local.x, 0.001, 0.999)) / 3.0, local.y);
}
