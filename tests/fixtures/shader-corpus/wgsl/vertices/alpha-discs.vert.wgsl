fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
    var corners = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
    let disc = vertexIndex / 6u;
    let corner = corners[vertexIndex % 6u];
    let angle = f32(disc) * 2.094 + iTime * 0.5;
    *position = vec3f(vec2f(cos(angle), sin(angle)) * 0.3 + corner * 0.45, f32(disc) * 0.05);
    let local = corner * 0.5 + 0.5;
    *uv = vec2f((f32(disc) + clamp(local.x, 0.001, 0.999)) / 3.0, local.y);
}
