const vec2 points[6] = vec2[6](
    vec2( 0.25, 0.433), vec2(-0.25, 0.433),
    vec2( 0.5,  0.0),   vec2(-0.5,  0.0),
    vec2( 0.25,-0.433), vec2(-0.25,-0.433)
);

void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
    position = vec3(points[vertexIndex] * (0.9 + 0.1 * sin(iTime)), 0.0);
}
