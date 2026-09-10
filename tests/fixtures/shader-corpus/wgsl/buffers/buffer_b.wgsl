// BufferB — glow. Runs at HALF resolution (resolution.scale 0.5 in config).
//   iChannel0 = BufferA (previous frame — cross-buffer read)
//
// 5x5 box blur of BufferA. iResolution here is the half-size buffer's own
// resolution — per-pass resolution test.
//
// WGSL mirror of ../../buffers/buffer_b.slang.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;

    var acc = vec3f(0.0);
    for (var i = -2; i <= 2; i += 1) {
        for (var j = -2; j <= 2; j += 1) {
            let off = vec2f(f32(i), f32(j)) / iResolution.xy * 2.0;
            acc += iChannel0Sample(uv + off).rgb;
        }
    }

    return vec4f(acc / 25.0, 1.0);
}
