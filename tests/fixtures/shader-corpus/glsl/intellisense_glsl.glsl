// GLSL ES 3.00 IntelliSense catalogue fixture.
// Hover each call or gl_* variable to inspect its signature and description.

float exerciseScalarIntrinsics(float inputValue)
{
    float x = clamp(fract(abs(inputValue)), 0.1, 0.9);
    float integralPart = 0.0;
    float value = acos(x) + acosh(x + 1.0) + asin(x) + asinh(x);
    value += atan(x) + atan(x, x + 0.1) + atanh(x * 0.5);
    value += ceil(x) + floor(x) + trunc(x) + round(x) + roundEven(x);
    value += cos(x) + cosh(x) + sin(x) + sinh(x) + tan(x) + tanh(x);
    value += degrees(x) + radians(x);
    value += exp(x) + exp2(x) + log(x) + log2(x) + pow(x, 2.0);
    value += inversesqrt(x) + sqrt(x) + sign(x);
    value += max(x, 0.25) + min(x, 0.75) + mod(x, 0.3) + modf(x, integralPart);
    value += mix(x, 1.0 - x, 0.25) + step(0.5, x) + smoothstep(0.2, 0.8, x);
    value += isnan(x) ? 1.0 : 0.0;
    value += isinf(x) ? 1.0 : 0.0;
    return value * 0.003;
}

float exerciseVectorAndMatrixIntrinsics(vec2 uv)
{
    vec3 a = normalize(vec3(uv, 1.0));
    vec3 b = normalize(vec3(uv.yx, -1.0));
    vec3 normal = normalize(vec3(0.2, 0.4, 1.0));
    float value = distance(a, b) + dot(a, b) + length(a);
    vec3 vector = cross(a, b) + faceforward(normal, a, b) + reflect(a, normal) + refract(a, normal, 0.75);

    bool relation = any(lessThan(a, b)) || any(lessThanEqual(a, b));
    relation = relation || any(greaterThan(a, b)) || any(greaterThanEqual(a, b));
    bvec3 comparisons = not(equal(a, b));
    value += relation || any(notEqual(a, b)) ? 1.0 : 0.0;
    value += all(comparisons) ? 1.0 : 0.0;

    mat2 matrixValue = mat2(1.0, 2.0, 3.0, 4.0);
    mat2 componentProduct = matrixCompMult(matrixValue, matrixValue);
    mat2 outer = outerProduct(uv, uv.yx);
    mat2 transposed = transpose(matrixValue);
    mat2 inverted = inverse(matrixValue);
    value += determinant(matrixValue);
    value += componentProduct[0][0] + outer[0][0] + transposed[0][0] + inverted[0][0];

    return value + dot(vector, vec3(0.01));
}

float exerciseIntegerAndPackingIntrinsics(float x)
{
    int signedBits = floatBitsToInt(x);
    uint unsignedBits = floatBitsToUint(x);
    float signedFloat = intBitsToFloat(signedBits);
    float unsignedFloat = uintBitsToFloat(unsignedBits);
    vec2 halfPair = unpackHalf2x16(packHalf2x16(vec2(x)));
    vec2 snormPair = unpackSnorm2x16(packSnorm2x16(vec2(x)));
    vec2 unormPair = unpackUnorm2x16(packUnorm2x16(vec2(x)));
    return signedFloat + unsignedFloat + halfPair.x + snormPair.x + unormPair.x;
}

vec3 exerciseTextureIntrinsics(vec2 uv)
{
    ivec2 dimensions = textureSize(iChannel0, 0);
    ivec2 texel = clamp(ivec2(uv * vec2(dimensions)), ivec2(0), dimensions - 1);
    vec2 dx = dFdx(uv);
    vec2 dy = dFdy(uv);
    float derivative = fwidth(uv.x);

    vec4 sampled = texture(iChannel0, uv);
    sampled += texture(iChannel1, normalize(vec3(uv * 2.0 - 1.0, 1.0)));
    sampled += textureProj(iChannel0, vec3(uv, 1.0));
    sampled += textureLod(iChannel0, uv, 0.0);
    sampled += textureOffset(iChannel0, uv, ivec2(0));
    sampled += texelFetch(iChannel0, texel, 0);
    sampled += texelFetchOffset(iChannel0, texel, 0, ivec2(0));
    sampled += textureProjOffset(iChannel0, vec3(uv, 1.0), ivec2(0));
    sampled += textureLodOffset(iChannel0, uv, 0.0, ivec2(0));
    sampled += textureProjLod(iChannel0, vec3(uv, 1.0), 0.0);
    sampled += textureProjLodOffset(iChannel0, vec3(uv, 1.0), 0.0, ivec2(0));
    sampled += textureGrad(iChannel0, uv, dx, dy);
    sampled += textureGradOffset(iChannel0, uv, dx, dy, ivec2(0));
    sampled += textureProjGrad(iChannel0, vec3(uv, 1.0), dx, dy);
    sampled += textureProjGradOffset(iChannel0, vec3(uv, 1.0), dx, dy, ivec2(0));
    return sampled.rgb / 16.0 + derivative * 0.001;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec3 color = exerciseTextureIntrinsics(uv);
    color += exerciseScalarIntrinsics(uv.x + uv.y);
    color += exerciseVectorAndMatrixIntrinsics(uv) * 0.01;
    color += exerciseIntegerAndPackingIntrinsics(uv.x) * 0.00001;
    color += gl_FrontFacing ? vec3(0.01) : vec3(0.0);
    color += vec3(gl_FragCoord.xy / iResolution.xy, gl_PointCoord.x) * 0.001;
    gl_FragDepth = gl_FragCoord.z;
    fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}

// Legacy GLSL ES 1.00 names remain as tokens for explicit-version hover tests.
#if __VERSION__ < 300
vec4 exerciseLegacyTextureNames(vec2 uv, vec3 direction)
{
    return texture2D(iChannel0, uv)
        + texture2DProj(iChannel0, vec3(uv, 1.0))
        + texture2DLod(iChannel0, uv, 0.0)
        + texture2DProjLod(iChannel0, vec3(uv, 1.0), 0.0)
        + textureCube(iChannel1, direction)
        + textureCubeLod(iChannel1, direction, 0.0);
}
#endif
