// Shared helpers for the WGSL workspace-foundation test.
// WGSL mirror of the Slang import/include graph (lib/palette.slang +
// include/tone-map.slang + include/blur.slang), inlined here because WGSL
// has no module system: one common pass plus the shader file is the whole
// program. Same visuals, same helper names.

const kFoundationBlurRadius = 2;
const kWorkspaceExposure = 1.15;
const kFoundationWarm = vec3f(1.0, 0.18, 0.05);
const kFoundationCool = vec3f(0.04, 0.35, 1.0);

fn foundationPalette(phase: f32) -> vec3f {
    let blend = 0.5 + 0.5 * sin(phase * 6.2831853);
    return mix(kFoundationCool, kFoundationWarm, blend);
}

fn foundationToneMap(color: vec3f) -> vec3f {
    return vec3f(1.0) - exp(-color * kWorkspaceExposure);
}

fn foundationBlurHistory(uv: vec2f) -> vec3f {
    var sum = vec3f(0.0);
    var sampleCount = 0;
    for (var y = -kFoundationBlurRadius; y <= kFoundationBlurRadius; y += 1) {
        for (var x = -kFoundationBlurRadius; x <= kFoundationBlurRadius; x += 1) {
            let offset = vec2f(f32(x), f32(y)) / iResolution.xy * 2.0;
            sum += iChannel0Sample(uv + offset).rgb;
            sampleCount += 1;
        }
    }
    return sum / f32(sampleCount);
}

fn foundationBlob(position: vec2f, center: vec2f, radius: f32) -> f32 {
    let distanceFromCenter = length(position - center);
    return exp(-distanceFromCenter * distanceFromCenter / (radius * radius));
}
