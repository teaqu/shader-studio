// Element-count dispatch display for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/count-dispatch.slang. Reads the
// `samples` storage buffer (written by a 256-element count dispatch) from
// the Image pass — render-stage storage reads.

fn mainImage(coord: vec2f) -> vec4f {
    let p = (2.0 * coord - iResolution.xy) / iResolution.y;
    let x = clamp((p.x + 1.6) * 80.0, 0.0, 255.0);
    let index = u32(x);
    let value = samples[index];
    return vec4f(value, 0.2 + 0.8 * (1.0 - value), 1.0 - value, 1.0);
}
