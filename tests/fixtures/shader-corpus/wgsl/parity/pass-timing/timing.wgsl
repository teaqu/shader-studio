// Pass-timing test: a later buffer reads an earlier buffer's CURRENT frame.
// WGSL mirror of ../slang/parity/pass-timing/timing.slang (with a.wgsl and
// b.wgsl; b.sha.json covers the standalone BufferA->Image companion).

fn mainImage(coord: vec2f) -> vec4f {
    return iChannel0Sample(coord / iResolution.xy);
}
