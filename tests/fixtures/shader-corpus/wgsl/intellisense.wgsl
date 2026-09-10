// WGSL intrinsic catalogue for WGSL/WebGPU.
// WGSL mirror of ../slang/intellisense.slang.
//
// Hover each intrinsic call to inspect its signature and concise description.
// WGSL spelling substitutions vs the Slang original (same values on the
// exercised ranges) are marked with NOTE comments:
// - saturate -> clamp(x, 0, 1); rcp -> 1.0/x; rsqrt -> inverseSqrt
// - cospi/sinpi/tanpi -> cos/sin/tan of pi*x (WGSL has no *pi variants)
// - log10 -> log(x)/log(10.0); powr -> pow; mad -> fma
// - copysign(x, -1.0) -> -abs(x) (x is positive here)
// - sincos out-params -> separate sin/cos calls (WGSL has no sincos)
// - frexp/modf out-params -> WGSL __frexpResult/__modfResult members
// - f32tof16/f16tof32 -> quantizeToF16 (pure-f32, no f16 extension needed)
// - packHalf2x16 -> pack2x16float, unpackHalf2x16ToFloat -> unpack2x16float,
//   packSnorm2x16 -> pack2x16snorm, unpackSnorm2x16ToFloat -> unpack2x16snorm,
//   packSnorm4x8 -> pack4x8snorm, unpackSnorm4x8ToFloat -> unpack4x8snorm,
//   packUnorm2x16 -> pack2x16unorm, unpackUnorm2x16ToFloat -> unpack2x16unorm,
//   packUnorm4x8 -> pack4x8unorm, unpackUnorm4x8ToFloat -> unpack4x8unorm
// - countbits -> countOneBits, firstbithigh -> firstLeadingBit,
//   firstbitlow -> firstTrailingBit, reversebits -> reverseBits
// - asuint/asfloat/asint/bit_cast -> bitcast<u32>/bitcast<f32>/bitcast<i32>
// - ddx/ddy -> dpdx/dpdy; bool2 -> vec2<bool>; lerp -> mix
// - isFinite/isInf/isNan -> manual (x == x) / abs comparisons: WGSL removed
//   these builtins (tint:1312), so classification is spelled out
// - select(cond, a, b) -> select(b, a, cond) (argument order differs)
// Calls the Slang catalogue leaves commented stay commented here too.

fn exerciseScalarIntrinsics(input: f32) -> f32 {
    let x = clamp(fract(abs(input)), 0.1, 0.9);
    var exponentPart = 0;
    var integralPart = 0.0;
    var sinePart = 0.0;
    var cosinePart = 0.0;

    var value = acos(x) + acosh(x + 1.0);
    value += asin(x) + asinh(x);
    value += atan(x) + atan2(x, x + 0.1) + atanh(x * 0.5);
    value += ceil(x) + floor(x) + round(x) + trunc(x);
    // Slang exposes rint, but its WGSL target does not currently support it.
    // value += rint(x);
    value += cos(x) + cosh(x) + cos(3.14159265 * x); // NOTE: cospi
    value += sin(x) + sinh(x) + sin(3.14159265 * x); // NOTE: sinpi
    value += tan(x) + tanh(x) + tan(3.14159265 * x); // NOTE: tanpi
    value += degrees(x) + radians(x);
    value += exp(x) + exp2(x) + log(x) + log(x) / log(10.0) + log2(x); // NOTE: log10
    value += fma(x, 2.0, 1.0);
    // Slang exposes fdim, but its WGSL target does not currently support it.
    // value += fdim(x, 0.5);
    // Slang exposes these C-style variants, but its WGSL target does not currently support them.
    // value += fmax(x, 0.25) + fmin(x, 0.75) + fmod(x, 0.3);
    value += fract(x) + frexp(x).fract + f32(frexp(x).exp) + ldexp(x, 2); // NOTE: frexp members
    value += max(x, 0.25) + min(x, 0.75) + fma(x, 2.0, 1.0); // NOTE: mad -> fma
    value += modf(x).fract; // NOTE: modf members
    // Slang exposes nextafter, but its WGSL target does not currently support it.
    // value += nextafter(x, 1.0);
    value += pow(x, 2.0) + pow(x, 2.0); // NOTE: powr -> pow (x is positive)
    value += (1.0 / x) + inverseSqrt(x) + clamp(x, 0.0, 1.0) + sign(x) + sqrt(x); // NOTE: rcp/rsqrt/saturate
    value += smoothstep(0.2, 0.8, x) + step(0.5, x);
    sinePart = sin(x); // NOTE: WGSL has no sincos
    cosinePart = cos(x);
    value += sinePart + cosinePart;
    value += -abs(x); // NOTE: copysign(x, -1.0)

    // NOTE: WGSL removed isFinite/isInf/isNan (tint:1312) — classify manually.
    let finite = (x == x) && (abs(x) <= 3.402823466e+38);
    let infinite = (x == x) && !(abs(x) <= 3.402823466e+38);
    let notNumber = !(x == x);
    let every = all(vec2<bool>(finite, !infinite));
    let either = any(vec2<bool>(notNumber, finite));
    value += select(0.0, 1.0, every && either); // NOTE: select args reorder

    // Slang exposes clip, but its WGSL target does not currently support it.
    // clip(value + 1.0);
    return value * 0.002;
}

fn exerciseBitAndPackingIntrinsics(x: f32) -> f32 {
    let bits = bitcast<u32>(x);
    let fromBits = bitcast<f32>(bits);
    let signedBits = bitcast<i32>(bits);
    let genericBits = bitcast<u32>(x);
    // Slang currently emits invalid WGSL precedence for these bitfield operations.
    // let inserted = bitfieldInsert(genericBits, 3u, 1u, 2u);
    // let extracted = bitfieldExtract(inserted, 1u, 2u);
    let counted = countOneBits(bits);
    let high = firstLeadingBit(bits);
    let low = firstTrailingBit(bits);
    let reversed = reverseBits(bits);

    let halfValue = quantizeToF16(x); // NOTE: f32tof16/f16tof32 round-trip
    let halfPair = unpack2x16float(pack2x16float(vec2f(x)));
    let snormPair = unpack2x16snorm(pack2x16snorm(vec2f(x)));
    let snormQuad = unpack4x8snorm(pack4x8snorm(vec4f(x)));
    let unormPair = unpack2x16unorm(pack2x16unorm(vec2f(x)));
    let unormQuad = unpack4x8unorm(pack4x8unorm(vec4f(x)));

    return fromBits + f32(signedBits & 1) + f32(genericBits + counted + high + low + reversed) * 0.000001
        + halfValue + halfPair.x + snormPair.x + snormQuad.x + unormPair.x + unormQuad.x;
}

fn exerciseVectorMatrixAndDerivativeIntrinsics(uv: vec2f) -> vec3f {
    let a = normalize(vec3f(uv, 1.0));
    let b = normalize(vec3f(uv.yx, -1.0));
    let normal = normalize(vec3f(0.2, 0.4, 1.0));

    var scalar = distance(a, b) + dot(a, b) + length(a);
    var vector = cross(a, b);
    vector += faceForward(normal, a, b);
    vector += mix(a, b, 0.25);
    vector += reflect(a, normal) + refract(a, normal, 0.75);

    let transform = mat2x2f(1.0, 2.0, 3.0, 4.0);
    let determinantValue = determinant(transform);
    let transformed = transform * uv;
    let transposed = transpose(transform);

    scalar += dpdx(uv.x);
    scalar += dpdy(uv.y);
    scalar += fwidth(uv.x);

    return vector * 0.05 + vec3f(transformed, determinantValue + transposed[0][0]) * 0.002 + scalar * 0.001;
}

// Slang exposes these intrinsics to IntelliSense, but its WGSL target currently
// rejects them when they are reachable from a fragment entry point.
fn exerciseTargetSpecificDerivativeIntrinsics(uv: vec2f) -> f32 {
    // Slang exposes these derivatives, but its WGSL target does not currently support them.
    // return ddx_coarse(uv.x) + ddx_fine(uv.x)
    //     + ddy_coarse(uv.y) + ddy_fine(uv.y);
    return uv.x * 0.0;
}

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let direction = normalize(vec3f(uv * 2.0 - 1.0, 1.0));
    var color = iChannel0Sample(uv).rgb * 0.55;
    color += iChannel1Sample(direction).rgb * 0.25;
    color += exerciseVectorMatrixAndDerivativeIntrinsics(uv);
    color += exerciseScalarIntrinsics(uv.x + uv.y);
    color += exerciseBitAndPackingIntrinsics(uv.x) * 0.0001;
    return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
