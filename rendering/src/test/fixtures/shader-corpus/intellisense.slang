// Slang IntelliSense catalogue fixture.
//
// Hover each intrinsic call to inspect its signature and concise description.
// Calls supported by Shader Studio's WGSL target stay live in mainImage.
// Unsupported catalogue calls remain commented beside their supported alternatives.

float exerciseScalarIntrinsics(float input)
{
    float x = clamp(frac(abs(input)), 0.1, 0.9);
    int exponentPart = 0;
    float integralPart = 0.0;
    float sinePart = 0.0;
    float cosinePart = 0.0;

    float value = acos(x) + acosh(x + 1.0);
    value += asin(x) + asinh(x);
    value += atan(x) + atan2(x, x + 0.1) + atanh(x * 0.5);
    value += ceil(x) + floor(x) + round(x) + trunc(x);
    // Slang exposes rint, but its WGSL target does not currently support it.
    // value += rint(x);
    value += cos(x) + cosh(x) + cospi(x);
    value += sin(x) + sinh(x) + sinpi(x);
    value += tan(x) + tanh(x) + tanpi(x);
    value += degrees(x) + radians(x);
    value += exp(x) + exp2(x) + log(x) + log10(x) + log2(x);
    value += fma(x, 2.0, 1.0);
    // Slang exposes fdim, but its WGSL target does not currently support it.
    // value += fdim(x, 0.5);
    // Slang exposes these C-style variants, but its WGSL target does not currently support them.
    // value += fmax(x, 0.25) + fmin(x, 0.75) + fmod(x, 0.3);
    value += fract(x) + frexp(x, exponentPart) + ldexp(x, 2);
    value += max(x, 0.25) + min(x, 0.75) + mad(x, 2.0, 1.0);
    value += modf(x, integralPart);
    // Slang exposes nextafter, but its WGSL target does not currently support it.
    // value += nextafter(x, 1.0);
    value += pow(x, 2.0) + powr(x, 2.0);
    value += rcp(x) + rsqrt(x) + saturate(x) + sign(x) + sqrt(x);
    value += smoothstep(0.2, 0.8, x) + step(0.5, x);
    sincos(x, sinePart, cosinePart);
    value += sinePart + cosinePart;
    value += copysign(x, -1.0);

    bool finite = isfinite(x);
    bool infinite = isinf(x);
    bool notNumber = isnan(x);
    bool every = all(bool2(finite, !infinite));
    bool either = any(bool2(notNumber, finite));
    value += select(every && either, 1.0, 0.0);

    // Slang exposes clip, but its WGSL target does not currently support it.
    // clip(value + 1.0);
    return value * 0.002;
}

float exerciseBitAndPackingIntrinsics(float x)
{
    uint bits = asuint(x);
    float fromBits = asfloat(bits);
    int signedBits = asint(bits);
    uint genericBits = bit_cast<uint>(x);
    // Slang currently emits invalid WGSL precedence for these bitfield operations.
    // uint inserted = bitfieldInsert(genericBits, 3u, 1u, 2u);
    // uint extracted = bitfieldExtract(inserted, 1u, 2u);
    uint counted = countbits(bits);
    uint high = firstbithigh(bits);
    uint low = firstbitlow(bits);
    uint reversed = reversebits(bits);

    uint halfBits = f32tof16(x);
    float halfValue = f16tof32(halfBits);
    float2 halfPair = unpackHalf2x16ToFloat(packHalf2x16(float2(x)));
    float2 snormPair = unpackSnorm2x16ToFloat(packSnorm2x16(float2(x)));
    float4 snormQuad = unpackSnorm4x8ToFloat(packSnorm4x8(float4(x)));
    float2 unormPair = unpackUnorm2x16ToFloat(packUnorm2x16(float2(x)));
    float4 unormQuad = unpackUnorm4x8ToFloat(packUnorm4x8(float4(x)));

    return fromBits + float(signedBits & 1) + float(genericBits + counted + high + low + reversed) * 0.000001
        + halfValue + halfPair.x + snormPair.x + snormQuad.x + unormPair.x + unormQuad.x;
}

float3 exerciseVectorMatrixAndDerivativeIntrinsics(float2 uv)
{
    float3 a = normalize(float3(uv, 1.0));
    float3 b = normalize(float3(uv.yx, -1.0));
    float3 normal = normalize(float3(0.2, 0.4, 1.0));

    float scalar = distance(a, b) + dot(a, b) + length(a);
    float3 vector = cross(a, b);
    vector += faceforward(normal, a, b);
    vector += lerp(a, b, 0.25);
    vector += reflect(a, normal) + refract(a, normal, 0.75);

    float2x2 transform = float2x2(1.0, 2.0, 3.0, 4.0);
    float determinantValue = determinant(transform);
    float2 transformed = mul(transform, uv);
    float2x2 transposed = transpose(transform);

    scalar += ddx(uv.x);
    scalar += ddy(uv.y);
    scalar += fwidth(uv.x);

    return vector * 0.05 + float3(transformed, determinantValue + transposed[0][0]) * 0.002 + scalar * 0.001;
}

// Slang exposes these intrinsics to IntelliSense, but its WGSL target currently
// rejects them when they are reachable from a fragment entry point.
float exerciseTargetSpecificDerivativeIntrinsics(float2 uv)
{
    // Slang exposes these derivatives, but its WGSL target does not currently support them.
    // return ddx_coarse(uv.x) + ddx_fine(uv.x)
    //     + ddy_coarse(uv.y) + ddy_fine(uv.y);
    return uv.x * 0.0;
}

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 direction = normalize(float3(uv * 2.0 - 1.0, 1.0));
    float3 color = inputs.iChannel0.Sample(uv).rgb * 0.55;
    color += inputs.iChannel1.Sample(direction).rgb * 0.25;
    color += exerciseVectorMatrixAndDerivativeIntrinsics(uv);
    color += exerciseScalarIntrinsics(uv.x + uv.y);
    color += exerciseBitAndPackingIntrinsics(uv.x) * 0.0001;
    return float4(saturate(color), 1.0);
}
