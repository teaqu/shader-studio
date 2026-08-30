vec3 revcol(float r, float g, float b) {
    return vec3(1.0 - r, 1.0 - g, 1.0 - b);
}
float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
d

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Fractal brownian motion~
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;

    for (int i = 0; i < 3; i++) {
        v += a * noise(p);
        p *= 2.03;
        a *= 0.5;
    }

    return v;
}
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = (fragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    vec3 rad = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));
    float sq = (abs(uv.x), abs(uv.y));

    vec3 col =  vec3(sq); // Red square ring

    col = 1.0 - col;
    col *= rad;

    vec2 p = uv * 10.0;
    p += vec2(
        fbm(p * 0.5 + vec2(iTime * 0.12, 1.7)),
        fbm(p * 0.6 + vec2(4.2, -iTime * 0.16))
    ) * 9.0;

    float n = fbm(p + vec2(0.0, iTime * 0.7));
    float edge = 2.0 - smoothstep(0.08, 0.22, abs(n - 0.52));

    float shimmer = fbm(p * 2.4 + iTime * 0.25);

    vec4 tex = vec4(edge * shimmer) * 0.08;

    fragColor =  tex + vec4(col,1.0);
}
