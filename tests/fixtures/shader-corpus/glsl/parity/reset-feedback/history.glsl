void mainImage(out vec4 c, in vec2 p)
{
    vec4 previous = texture(iChannel0, p / iResolution.xy);
    if (iFrame == 0) { c = length(previous.rgb) < 0.001 ? vec4(0.0, 0.8, 0.1, 1.0) : vec4(0.9, 0.0, 0.0, 1.0); return; }
    c = mix(previous, vec4(0.05, 0.15, 0.9, 1.0), 0.025);
}
