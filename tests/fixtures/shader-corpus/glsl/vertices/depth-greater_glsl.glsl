// Two overlapping quads, red in front of green. With "compare": "greater" the farther (green) one wins.
// Delete the depth setting to see the usual result: the nearer red quad hides the green one.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = fragCoord.x > 0.5 * iResolution.x ? vec4(0.2, 0.9, 0.3, 1.0) : vec4(0.95, 0.2, 0.2, 1.0);
}
