// particles.wgsl — main Image pass: reads and renders storage buffer data.
// WGSL mirror of ../slang/particles.slang (the compute passes live in
// init.wgsl and present.wgsl; config in particles.sha.json).

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let tex = iChannel0Sample(uv);
    return tex;
}
