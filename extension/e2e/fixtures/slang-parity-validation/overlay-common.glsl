// The Image pass leans on the common file for both a macro and a helper, the
// way a multi-pass GLSL shader normally shares code.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float wave = sin(uv.x * TAU) * twice(0.25);
    fragColor = vec4(vec3(wave), 1.0);
}
