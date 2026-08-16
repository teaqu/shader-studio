// Vertex-stage GLSL IntelliSense fixture for stage-specific built-ins.
void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv)
{
    int indices = gl_VertexID + gl_InstanceID;
    gl_PointSize = 1.0 + float(indices & 1);
    gl_Position += vec4(0.0);
    position.xy += vec2(float(indices)) * 0.000001;
}
