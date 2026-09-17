fn mainImage(fragCoord: vec2f) -> vec4f {
    let uv = fragCoord / iResolution.xy;
    return vec4f(uv, iDayOfWeek, 1.0);
}
