// Feature-coverage history buffer for WGSL/WebGPU.
// WGSL mirror of ../slang/feature-coverage.buffer.slang.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let textureColor = patternTexSample(uv).rgb;
    let pulse = 0.5 + 0.5 * sin(iTime + uFloat);
    return vec4f(mix(textureColor, coveragePalette(uv.x * 3.0), pulse * 0.35), 1.0);
}
