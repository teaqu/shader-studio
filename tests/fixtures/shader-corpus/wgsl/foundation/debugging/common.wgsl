// Shared helpers for the WGSL debug-coverage test.
// WGSL mirror of the Slang import graph (debugmath + debugpalette +
// debugfeedback modules and debugging/common.slang), inlined here because
// WGSL has no module system. The debug-coverage target is the same orange /
// blue feedback with palette bands, vignette, and tone map.

fn debugWave(phase: f32) -> f32 {
    var accumulated = 0.0;

    // Inspect index, harmonic, contribution, and accumulated while stepping here.
    for (var index = 0; index < 4; index += 1) {
        let harmonic = f32(index + 1);
        let contribution = sin(phase * harmonic * 6.2831853) / harmonic;
        accumulated += contribution;
    }

    let result = clamp(0.5 + accumulated * 0.22, 0.0, 1.0);
    return result;
}

fn debugPalette(phase: f32) -> vec3f {
    let blend = debugWave(phase);
    let coolColor = vec3f(0.03, 0.22, 1.0);
    let warmColor = vec3f(1.0, 0.12, 0.38);
    let color = mix(coolColor, warmColor, blend);
    return color;
}

fn debugFeedbackDecay(sampledHistory: vec3f, phase: f32) -> vec3f {
    var accumulated = vec3f(0.0);

    // Imported modules do not depend on Shader Studio's sampling prelude. This
    // loop operates on the history value passed in by the owning buffer pass.
    for (var index = 0; index < 4; index += 1) {
        let harmonic = f32(index + 1);
        let modulation = 0.97 + 0.005 * sin(phase * harmonic);
        accumulated += sampledHistory * modulation;
    }

    let decayed = accumulated * 0.25;
    return decayed;
}

fn debugVignette(uv: vec2f) -> f32 {
    let centered = uv * 2.0 - 1.0;
    let radiusSquared = dot(centered, centered);
    let vignette = 1.0 - 0.28 * radiusSquared;
    return clamp(vignette, 0.0, 1.0);
}

fn debugToneMap(color: vec3f) -> vec3f {
    let exposure = 1.2;
    let mapped = vec3f(1.0) - exp(-color * exposure);
    return mapped;
}
