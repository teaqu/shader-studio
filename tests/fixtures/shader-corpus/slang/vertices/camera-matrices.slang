// Green confirms that the separate view/projection matrices equal iViewProjection.
// Drag to orbit the cube: all three matrices follow the same camera.
float4 mainImage(float2 fragCoord) {
    float4 worldPoint = float4(0.25, -0.15, 0.1, 1.0);
    float4 separate = mul(iProjectionMatrix, mul(iViewMatrix, worldPoint));
    float4 combined = mul(iViewProjection, worldPoint);
    bool matches = length(separate - combined) < 0.001;
    return matches ? float4(0.0, 1.0, 0.15, 1.0) : float4(1.0, 0.0, 0.15, 1.0);
}
