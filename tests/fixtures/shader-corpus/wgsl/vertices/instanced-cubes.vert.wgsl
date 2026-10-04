// One cube drawn 100 times ("instanceCount": 100): iInstanceIndex places each copy on a 10 x 10 grid.
fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
    let cell = vec2f(f32(iInstanceIndex % 10u), f32(iInstanceIndex / 10u)) - 4.5;
    let height = 0.5 + 0.5 * sin(cell.x * 0.7 + cell.y * 1.3);
    *position = *position * vec3f(0.07, 0.07 + 0.2 * height, 0.07) + vec3f(cell.x * 0.2, 0.0, cell.y * 0.2);
}
