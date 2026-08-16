void mainImage(out vec4 c, in vec2 p)
{
    float actual = texture(iChannel0, vec2(0.5)).r;
    float expected = float(iFrame & 1);
    c = actual == expected ? vec4(1.0, 0.8, 0.1, 1.0) : vec4(0.9, 0.0, 0.0, 1.0);
}
