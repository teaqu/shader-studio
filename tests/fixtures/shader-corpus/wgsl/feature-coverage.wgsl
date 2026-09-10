// Feature-coverage kitchen sink for WGSL/WebGPU.
// WGSL mirror of ../slang/feature-coverage.slang (with
// feature-coverage.buffer.wgsl, feature-coverage.common.wgsl, and
// feature-coverage.vert.wgsl; config + uniforms.ts script shared).
//
// Exercises in one frame: rotated custom-named texture sampling, a local
// array with a counted loop, a common-file struct, overloaded helpers,
// derivatives, bit ops on iFrame, channel metadata, buffer feedback, script
// uniforms, and a channel-offset vertex hook.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let centered = uv - 0.5;
    let angle = 0.15 + uFloat * 0.2;
    let sine = sin(angle);
    let cosine = cos(angle);
    let rotated = mat2x2f(cosine, -sine, sine, cosine) * centered + 0.5;

    var weights = array<f32, 3>(0.2, 0.3, 0.5);
    var weighted = 0.0;
    for (var index = 0; index < 3; index += 1) {
        weighted += weights[index];
    }

    var sample: CoverageSample;
    sample.color = patternTexSample(rotated).rgb;
    sample.energy = dot(sample.color, vec3f(0.299, 0.587, 0.114));
    let history = historyBufferSample(uv).rgb;
    let edge = clamp(length(vec2f(dpdx(sample.energy), dpdy(sample.energy))) * 8.0, 0.0, 1.0);
    let flags = (u32(iFrame) & 1u) | 2u;
    let flagValue = select(0.75, 1.0, flags == 2u);
    let channelReady = select(0.0, 1.0, patternTexSize().x > 0u);

    var color = mix(coverageGainVec(sample.color), history, 0.35);
    color += coveragePalette(uv.y * 4.0 + iTime) * edge * 0.15;
    color *= weighted * flagValue * channelReady;
    color = mix(color, uVec3, select(0.0, 0.08, uBool));
    color += vec3f(uVec2, uVec4.x) * 0.03;
    return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
