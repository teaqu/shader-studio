// Custom channel-name binding test for WGSL/WebGPU.
// WGSL mirror of ../slang/parity/channels/named.slang.
//
// The config binds the texture as `albedo` instead of iChannelN, so the
// free function is `albedoSample` — channel accessors are named after the
// config key. A missing binding fails to compile; a wrong texture shows the
// wrong edges (expect red top, green left).

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let sampled = albedoSample(uv).rgb;
    return vec4f(sampled, 1.0);
}
