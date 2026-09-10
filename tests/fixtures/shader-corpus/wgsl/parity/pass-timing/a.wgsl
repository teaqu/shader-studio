// Frame-parity marker: alternates red brightness every frame.
// WGSL mirror of ../slang/parity/pass-timing/a.slang.
//
// Zero and one are represented exactly by both rgba16float and rgba32float.
// Alternating every frame makes a previous-frame read fail deterministically.

fn mainImage(coord: vec2f) -> vec4f {
    let marker = f32(iFrame & 1);
    return vec4f(marker, 0.0, 0.0, 1.0);
}
