// Clip-space points: 1024 single-pixel points on a swirling 32x32 grid.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = vec4(fragCoord / iResolution.xy, 1.0, 1.0);
}
