void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv)
{
    float ripple = sin(uv.y * 20.0 + iTime) * 0.1;
    position.x += ripple;
    position.y += cos(uv.x * 20.0 + iTime) * 0.1;
}
