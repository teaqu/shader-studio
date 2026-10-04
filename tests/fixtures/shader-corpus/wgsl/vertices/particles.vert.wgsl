fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
    var corners = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
    let id = f32(vertexIndex / 6u);
    let corner = corners[vertexIndex % 6u];
    let centre = vec3f(sin(id * 1.7 + iTime), cos(id * 2.3 + iTime * 0.5), sin(id * 0.9)) * 0.8;
    *position = centre + vec3f(corner * 0.04, 0.0);
    *uv = corner * 0.5 + 0.5;
}
