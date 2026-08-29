float4 mainImage(float2 fragCoord)
{
    float a = alpha;
    float b = beta;
    float c = gamma;
    float d = delta;
    float e = epsilon;
    float f = zeta;
    float g = eta;
    float h = theta;
    return float4(a + b + c + d + e + f + g + h);
}
