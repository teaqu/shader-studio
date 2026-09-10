fn mainImage(coord: vec2f) -> vec4f {
    let converted = bitcast<f32>(42u);
    let channels = vec4f(converted).xyzw;
    return channels;
}
