// Dispatch mode gallery. Clockwise from top-left:
// texel, count, explicit workgroups, storage cover.
// WGSL mirror of ../slang/compute-lab/dispatch-modes.slang.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let localUv = fract(uv * 2.0);
    let texel = iChannel0Sample(localUv);
    let count = iChannel1Sample(localUv);
    let workgroups = iChannel2Sample(localUv);
    let storageCover = iChannel3Sample(localUv);
    if (uv.x < 0.5 && uv.y >= 0.5) { return texel; }
    if (uv.x >= 0.5 && uv.y >= 0.5) { return count; }
    if (uv.x < 0.5) { return workgroups; }
    return storageCover;
}
