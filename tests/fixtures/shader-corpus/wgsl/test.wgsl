fn mainImage(coord: vec2<f32>) -> vec4<f32> {
    let uv = coord / iResolution.xy;

    return vec4<f32>(uv, 1.0, 1.0);
}
