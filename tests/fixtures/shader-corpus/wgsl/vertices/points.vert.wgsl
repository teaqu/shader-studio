fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
    let cell = vec2f(f32(vertexIndex % 32u), f32(vertexIndex / 32u)) / 31.0 * 1.6 - 0.8;
    let angle = length(cell) * 2.0 - iTime * 0.5;
    let c = cos(angle);
    let s = sin(angle);
    *position = vec3f(cell.x * c - cell.y * s, cell.x * s + cell.y * c, 0.0);
}
