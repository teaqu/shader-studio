// Storage inspector test: edit the four float4 values in the Storage panel.
// Each element controls one quadrant: top-left, top-right, bottom-left, bottom-right.
float4 mainImage(float2 fragCoord)
{
    uint column = fragCoord.x >= iResolution.x * 0.5 ? 1u : 0u;
    uint row = fragCoord.y >= iResolution.y * 0.5 ? 0u : 1u;
    return float4(colours[row * 2u + column].rgb, 1.0);
}
