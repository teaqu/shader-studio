void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv)
{
    position.x *= sin(iTime);
    position.y *= cos(iTime);
    position.z *= sin(iTime * 0.5);
}
