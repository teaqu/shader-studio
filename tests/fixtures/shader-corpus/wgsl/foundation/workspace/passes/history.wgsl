// Workspace-foundation history buffer for WGSL/WebGPU.
// WGSL mirror of ../slang/foundation/workspace/passes/history.slang.

fn mainImage(coord: vec2f) -> vec4f {
    let resolution = iResolution.xy;
    let uv = coord / resolution;
    let downwardDrift = vec2f(0.0, 1.5) / resolution;
    let previous = iChannel0Sample(uv + downwardDrift).rgb * 0.985;

    let emitter = resolution * (vec2f(0.5) + 0.32 * vec2f(cos(iTime * 0.7), sin(iTime * 1.3)));
    var ink = foundationPalette(iTime * 0.11) * foundationBlob(coord, emitter, 12.0);
    if (iMouse.z > 0.0) {
        ink += vec3f(1.0) * foundationBlob(coord, iMouse.xy, 10.0);
    }

    return vec4f(foundationToneMap(previous + ink), 1.0);
}
