// Green confirms that the separate view/projection matrices equal iViewProjection.
// Drag to orbit the cube: all three matrices follow the same camera.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec4 worldPoint = vec4(0.25, -0.15, 0.1, 1.0);
    vec4 separate = iProjectionMatrix * iViewMatrix * worldPoint;
    vec4 combined = iViewProjection * worldPoint;
    bool matches = length(separate - combined) < 0.001;
    fragColor = matches ? vec4(0.0, 1.0, 0.15, 1.0) : vec4(1.0, 0.0, 0.15, 1.0);
}
