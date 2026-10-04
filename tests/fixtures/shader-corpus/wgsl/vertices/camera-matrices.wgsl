// Green confirms that the separate view/projection matrices equal iViewProjection.
// Drag to orbit the cube: all three matrices follow the same camera.
fn mainImage(fragCoord: vec2f) -> vec4f {
    let worldPoint = vec4f(0.25, -0.15, 0.1, 1.0);
    let separate = iProjectionMatrix * iViewMatrix * worldPoint;
    let combined = iViewProjection * worldPoint;
    let matches = length(separate - combined) < 0.001;
    return select(vec4f(1.0, 0.0, 0.15, 1.0), vec4f(0.0, 1.0, 0.15, 1.0), matches);
}
