// The Common pass supplies `twice`.

fn shade(value: f32) -> f32 {
    return twice(value) * 0.5;
}

fn mainImage(pixelPosition: vec2f) -> vec4f {
    let literalColor = vec3f(1.0, 0.5, 0.0);
    let uv = pixelPosition / iResolution.xy;
    let remainder = fract(literalColor.r + f32(iChannel0.loaded));
    return iChannel0Sample(uv) + vec4f(shade(remainder));
}
