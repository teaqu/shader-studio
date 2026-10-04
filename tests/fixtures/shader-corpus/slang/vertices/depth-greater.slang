// Two overlapping quads, red in front of green. With "compare": "greater" the farther (green) one wins.
// Delete the depth setting to see the usual result: the nearer red quad hides the green one.
float4 mainImage(float2 fragCoord) {
    return fragCoord.x > 0.5 * iResolution.x ? float4(0.2, 0.9, 0.3, 1.0) : float4(0.95, 0.2, 0.2, 1.0);
}
