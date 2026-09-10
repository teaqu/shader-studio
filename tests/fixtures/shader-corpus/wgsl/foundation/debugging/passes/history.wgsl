// Debug-coverage history buffer for WGSL/WebGPU.
// WGSL mirror of ../slang/foundation/debugging/passes/history.slang (the
// debugfeedback import is inlined into ../common.wgsl).

fn debugBlob(position: vec2f, center: vec2f, radius: f32) -> f32 {
    let delta = position - center;
    let distanceSquared = dot(delta, delta);
    let blob = exp(-distanceSquared / (radius * radius));
    return blob;
}

fn mainImage(coord: vec2f) -> vec4f {
    let resolution = iResolution.xy;
    let uv = coord / resolution;
    let texelSize = 1.0 / resolution;

    let sampledHistory = iChannel0Sample(uv + vec2f(0.0, 0.7) * texelSize).rgb;
    let previous = debugFeedbackDecay(sampledHistory, iTime);
    let emitter = resolution * (0.5 + 0.3 * vec2f(cos(iTime * 0.73), sin(iTime * 1.11)));
    let newInk = debugBlob(coord, emitter, 13.0);
    var inkColor = vec3f(1.0, 0.28, 0.08) * newInk;

    if (iMouse.z > 0.0) {
        let mouseInk = debugBlob(coord, iMouse.xy, 17.0);
        inkColor += vec3f(0.12, 0.7, 1.0) * mouseInk;
    }

    let history = previous * 0.975 + inkColor;
    let vignette = debugVignette(uv);
    return vec4f(history * vignette, 1.0);
}
