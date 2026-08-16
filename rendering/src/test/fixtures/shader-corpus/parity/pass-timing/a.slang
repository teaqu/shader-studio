float4 mainImage(float2 fragCoord)
{
    // Zero and one are represented exactly by both rgba16float and rgba32float.
    // Alternating every frame makes a previous-frame read fail deterministically.
    float marker = float(iFrame & 1);
    return float4(marker, 0.0, 0.0, 1.0);
}
