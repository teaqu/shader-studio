void mainImage(out vec4 c, in vec2 p)
{
    float actual = texture(iChannel0, p / iResolution.xy).r >= 0.5 ? 1.0 : 0.0;
    float expected = length(p - vec2(64.0)) < 18.0 ? 1.0 : 0.0;
    float mismatch = abs(actual - expected);

    // Green circle + black background means preserved correctly. Any red
    // marks either a shifted historical pixel or a missing expected pixel.
    c = mismatch > 0.5
        ? vec4(0.9, 0.0, 0.0, 1.0)
        : expected > 0.5
            ? vec4(0.0, 0.8, 0.1, 1.0)
            : vec4(0.0, 0.0, 0.0, 1.0);
}
