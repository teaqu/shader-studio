// BufferB - glow. Runs at HALF resolution (resolution.scale 0.5 in config).
//   iChannel0 = BufferA (previous frame - cross-buffer read)
//
// 5x5 box blur of BufferA. iResolution here is the half-size buffer's own
// resolution - per-pass resolution test.

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;

    vec3 acc = vec3(0.0);
    for (int i = -2; i <= 2; i++)
    {
        for (int j = -2; j <= 2; j++)
        {
            vec2 off = vec2(float(i), float(j)) / iResolution.xy * 2.0;
            acc += texture(iChannel0, uv + off).rgb;
        }
    }

    fragColor = vec4(acc / 25.0, 1.0);
}
