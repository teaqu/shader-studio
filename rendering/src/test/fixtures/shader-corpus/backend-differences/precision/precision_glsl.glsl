void mainImage(out vec4 c, in vec2 p)
{
    float value = texture(iChannel0, p / iResolution.xy).r;
    float expected = float(iFrame + 1) * 0.0001;
    float error = abs(value - expected);
    c = vec4(clamp(error * 2000.0, 0.0, 1.0), clamp(1.0 - error * 2000.0, 0.0, 1.0), 0.0, 1.0);
}
