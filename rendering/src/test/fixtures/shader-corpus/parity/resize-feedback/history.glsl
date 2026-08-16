void mainImage(out vec4 c, in vec2 p)
{
    vec2 uv = p / iResolution.xy;
    vec4 previous = texture(iChannel0, uv);
    // Fixed pixel coordinates make the resize contract unambiguous: feedback
    // preserves its absolute position relative to the bottom-left corner.
    float seed = iFrame < 8 && length(p - vec2(64.0)) < 18.0 ? 1.0 : 0.0;
    c = max(previous, vec4(seed, seed, seed, 1.0));
}
