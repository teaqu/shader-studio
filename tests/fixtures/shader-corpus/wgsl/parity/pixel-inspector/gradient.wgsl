// Pixel-inspector gradient for WGSL/WebGPU.
// WGSL mirror of ../slang/parity/pixel-inspector/gradient.slang (no config -
// open it with a default Image pass). Inspector values must equal the
// normalized pixel coordinates: sweep rapidly, stop on a corner or center,
// and compare RGB against the coordinate readout.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    return vec4f(uv.x, uv.y, 0.25, 1.0);
}
