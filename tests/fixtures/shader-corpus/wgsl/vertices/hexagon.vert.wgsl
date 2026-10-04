fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
    var points = array<vec2f, 6>(
        vec2f( 0.25, 0.433), vec2f(-0.25, 0.433),
        vec2f( 0.5,  0.0),   vec2f(-0.5,  0.0),
        vec2f( 0.25,-0.433), vec2f(-0.25,-0.433)
    );
    *position = vec3f(points[vertexIndex] * (0.9 + 0.1 * sin(iTime)), 0.0);
}
