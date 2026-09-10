// structs.wgsl — main Image pass: reads struct buffer data and visualizes.
// WGSL mirror of ../slang/structs/structs.slang. Storage layout coverage
// lives in init.wgsl / present.wgsl with the five test structs in
// common.wgsl; config in structs.sha.json.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let tex = iChannel0Sample(uv);
    return tex;
}
