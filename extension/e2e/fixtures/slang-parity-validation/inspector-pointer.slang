float4 mainImage(float2 fragCoord)
{
    float4 previewColor = float4(0.0, 1.0, 0.0, 1.0) + float4(0.0, 0.0, 0.0, 0.0) + float4(0.0, 0.0, 0.0, 0.0) + float4(0.0, 0.0, 0.0, 0.0) + float4(0.0, 0.0, 0.0, 0.0) + float4(0.0, 0.0, 0.0, 0.0) + float4(0.0, 0.0, 0.0, 0.0) + float4(0.0, 0.0, 0.0, 0.0) + float4(0.0, 0.0, 0.0, 0.0) + float4(0.0, 0.0, 0.0, 0.0);
    return float4(1.0, 0.0, 0.0, 1.0);
}
// Keep the expression on L3 long: its real line tooltip wraps over the
// controls and captured rows. The main canvas is red, its variable green.
