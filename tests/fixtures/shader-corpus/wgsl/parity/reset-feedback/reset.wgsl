// Reset-feedback test: Reset must clear feedback before frame zero.
// WGSL mirror of ../slang/parity/reset-feedback/reset.slang (with
// history.wgsl). Let it turn blue, then press Reset: it must flash green,
// never red.

fn mainImage(coord: vec2f) -> vec4f {
    return iChannel0Sample(coord / iResolution.xy);
}
