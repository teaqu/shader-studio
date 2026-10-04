// Two overlapping quads, red in front of green. With "compare": "greater" the farther (green) one wins.
// Delete the depth setting to see the usual result: the nearer red quad hides the green one.
fn mainImage(fragCoord: vec2f) -> vec4f {
    return select(vec4f(0.95, 0.2, 0.2, 1.0), vec4f(0.2, 0.9, 0.3, 1.0), fragCoord.x > 0.5 * iResolution.x);
}
