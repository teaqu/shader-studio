// Script-driven custom uniforms smoke test for WGSL/WebGPU.
// WGSL mirror of ../slang/custom-uniforms.slang.
//
// Config (custom-uniforms.sha.json) runs custom-uniforms.ts, which supplies
// uRed, uGreen, uOffset as injected globals — do NOT declare them. Dragging
// the sliders (or the animated offset) must change the output; a constant
// color means script uniforms are not reaching WGSL.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;

    let r = uRed;
    let g = uGreen;
    let b = 0.5 + 0.5 * sin(iTime + uOffset);

    return vec4f(r, g, b, 1.0);
}
