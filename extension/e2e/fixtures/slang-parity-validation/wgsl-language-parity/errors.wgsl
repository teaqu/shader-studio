fn mainImage(coord: vec2f) -> vec4f {
    let shade = coord.x / iResolution.x;
    return vec4f(shade * mysteriousGain, 0.0, 0.0, 1.0);
}
