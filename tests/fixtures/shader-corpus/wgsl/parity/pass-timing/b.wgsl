// Pass-timing checker: green when the buffer feed is current-frame.
// WGSL mirror of ../slang/parity/pass-timing/b.slang.

fn mainImage(coord: vec2f) -> vec4f {
    let actual = iChannel0Sample(vec2f(0.5)).r;
    let expected = f32(iFrame & 1);
    return select(vec4f(0.9, 0.0, 0.0, 1.0), vec4f(0.0, 0.8, 0.1, 1.0), actual == expected);
}
