fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
    let line = f32(vertexIndex / 2u);
    let end = f32(vertexIndex % 2u);
    let angle = line * 0.0041 + iTime * 0.2;
    let radius = 0.2 + 0.6 * end;
    *position = vec3f(cos(angle * 3.0) * radius, sin(angle * 5.0) * radius, 0.0);
}
