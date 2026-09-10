void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv)
{
    float wave = sin(position.x * 5.0 + iTime) * cos(position.z * 5.0 + iTime) * 0.2;
    position.y += wave;
}
