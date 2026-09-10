void mainImage(out vec4 c, in vec2 p)
{
    float previous = texture(iChannel0, p / iResolution.xy).r;
    c = vec4(previous + 0.0001, 0.0, 0.0, 1.0);
}
