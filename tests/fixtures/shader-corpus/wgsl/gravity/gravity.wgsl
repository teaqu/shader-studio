// gravity.wgsl — main Image pass: reads gravity sim output.
// WGSL mirror of ../slang/gravity/gravity.slang. The simulation lives in
// init.wgsl / sim.wgsl / present.wgsl with shared types in common.wgsl.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let tex = iChannel0Sample(uv);
    return tex;
}
