fn mainImage(fragCoord: vec2f) -> vec4f {
    let remainder = fract(fragCoord.x * 0.75);
    return vec4f(unknownValue + remainder);
}
