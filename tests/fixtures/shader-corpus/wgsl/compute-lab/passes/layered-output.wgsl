// Two-layer texture writer for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/passes/layered-output.slang.
// Layer 0 is the sharp source, layer 1 a 5-tap blur; the config binds
// layer 1, so expect soft edges everywhere.

fn source(uv: vec2f) -> vec3f {
    let center = 0.5 + 0.22 * vec2f(cos(iTime), sin(iTime * 1.4));
    let disc = smoothstep(0.18, 0.14, length(uv - center));
    return mix(vec3f(0.025, 0.04, 0.11), vec3f(1.0, 0.22, 0.06), uv.y) + disc * vec3f(0.1, 0.9, 1.3);
}

@compute @workgroup_size(8, 8, 1)
fn writeLayers(@builtin(global_invocation_id) tid: vec3u) {
    let size = vec2u(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y) {
        return;
    }

    let coord = tid.xy;
    let uv = (vec2f(coord) + 0.5) / iResolution.xy;
    let texel = 1.0 / iResolution.xy;
    let blur = (source(uv) + source(uv + vec2f(texel.x, 0.0)) + source(uv - vec2f(texel.x, 0.0)) + source(uv + vec2f(0.0, texel.y)) + source(uv - vec2f(0.0, texel.y))) / 5.0;
    writeOutput(coord, 0u, vec4f(source(uv), 1.0));
    writeOutput(coord, 1u, vec4f(blur, 1.0));
}
