fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
    let x = -0.9 + 1.8 * f32(vertexIndex) / f32(iVertexCount - 1u);
    let y = 0.5 * sin(x * 6.0 + iTime * 2.0) * cos(x * 1.5 - iTime);
    *position = vec3f(x, y, 0.0);
}
