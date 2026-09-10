fn mainImage(coord: vec2f) -> vec4f {
    return iChannel0Sample(coord / iResolution.xy);
}
