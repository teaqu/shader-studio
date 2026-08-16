float4 mainImage(float2 fragCoord)
{
    float remainder = fmod(fragCoord.x, 0.75);
    return float4(unknownValue + remainder);
}
