fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
    var corners = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
    let quad = vertexIndex / 6u;
    let corner = corners[vertexIndex % 6u];
    let offset = select(vec2f(0.2, -0.1), vec2f(-0.2, 0.1), quad == 0u);
    *position = vec3f(corner * 0.5 + offset, select(-0.4, 0.4, quad == 0u));
    *uv = vec2f(f32(quad), 0.0);
}
