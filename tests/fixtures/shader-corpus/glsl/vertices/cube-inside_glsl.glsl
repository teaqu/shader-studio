// A cube with "cull": "front": the near faces are skipped, so you see the inside walls. Drag to orbit.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec3 grid = step(0.94, fract((iWorldPosition + 0.5) * 4.0));
    float lines = max(max(grid.x, grid.y), grid.z);
    vec3 colour = abs(iNormal) * 0.7 + 0.1;
    fragColor = vec4(mix(colour, vec3(1.0), lines), 1.0);
}
