fn mainImage(coord: vec2f) -> vec4f {
    let annotated: mat2x2f = mat2x2f(0.125, 0.25, 0.5, 0.75);
    let inferred = mat2x2<f32>(vec2f(0.75, 0.5), vec2f(0.25, 0.125));
    let fromCommon = commonBasis(coord);
    return vec4f(annotated[0] + inferred[1] + fromCommon[0], 0.0, 1.0);
}
