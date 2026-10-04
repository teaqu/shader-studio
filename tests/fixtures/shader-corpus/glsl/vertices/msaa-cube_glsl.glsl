// A cube with four-sample MSAA. Its silhouette should have partially covered edge pixels.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec3 light = normalize(vec3(0.4, 1.0, 0.3));
    float shade = 0.25 + 0.75 * max(dot(normalize(iNormal), light), 0.0);
    fragColor = vec4(vec3(0.2, 0.65, 1.0) * shade, 1.0);
}
