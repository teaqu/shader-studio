fn commonBasis(coord: vec2f) -> mat2x2<f32> {
    let basis = mat2x2<f32>(0.5, 0.25, 0.125, 0.75 + coord.x * 0.0);
    return basis;
}
