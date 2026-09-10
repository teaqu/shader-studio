// One-shot storage display for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/one-shot-storage.slang. The seed
// ring only changes after Reset/recompile; a jumping ring means the init
// pass is re-running every frame.

fn mainImage(coord: vec2f) -> vec4f {
    let p = (2.0 * coord - iResolution.xy) / iResolution.y;
    let radius = length(p - seed[0].xy);
    let ring = smoothstep(0.025, 0.0, abs(radius - 0.45));
    return vec4f(vec3f(0.015, 0.025, 0.05) + ring * vec3f(0.2, 0.8, 1.0), 1.0);
}
