// Original 32³ uniform noise, sampled with LINEAR + REPEAT.
vec4 readNoise(vec3 p) { return texture(iChannel0, p); }
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float panel = floor(uv.x * 3.0);
    vec2 q = vec2(fract(uv.x * 3.0), uv.y);
    vec3 p = vec3(q * 0.7, iTime * 0.04);
    vec3 result;
    if (panel < 1.0) {
        result = readNoise(p).rgb;
    } else if (panel < 2.0) {
        float value = 0.0; float weight = 0.5;
        for (int octave = 0; octave < 4; octave++) {
            value += readNoise(p).r * weight;
            p = p * 2.03 + vec3(0.17,0.31,0.23); weight *= 0.5;
        }
        result = vec3(value / 0.9375);
    } else {
        float value = readNoise(p).a;
        result = vec3(value);
    }
    result *= step(0.015,q.x) * step(q.x,0.985);
    fragColor = vec4(result,1.0);
}
